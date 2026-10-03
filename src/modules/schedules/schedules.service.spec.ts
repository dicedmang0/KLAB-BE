import { ConflictException } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { ScheduleStatus } from './entities/schedule.entity';
import { Room } from '../rooms/entities/room.entity';
import { Instructor } from '../instructors/entities/instructor.entity';
import { ClassType } from '../class-types/entities/class-type.entity';
import {
  SCHEDULE_INSTRUCTOR_CONFLICT,
  SCHEDULE_INVALID_TIME_INCREMENT,
  SCHEDULE_INVALID_TIME_RANGE,
  SCHEDULE_ROOM_CONFLICT,
} from './schedule-rules';

const wib = (s: string) => new Date(`2026-10-22T${s}:00+07:00`);

const rooms = {
  A: { id: 'room-a', name: 'Studio A', capacity: 20, status: 'active' },
  B: { id: 'room-b', name: 'Studio B', capacity: 20, status: 'active' },
};
const instructors = {
  jane: { id: 'ins-jane', first_name: 'Jane', last_name: 'Doe', status: 'active' },
  sari: { id: 'ins-sari', first_name: 'Sari', last_name: null, status: 'active' },
};
const classTypes = {
  ri: { id: 'ct-ri', name: 'Reformer Intermediate', status: 'active' },
  hm: { id: 'ct-hm', name: 'Hot Mat Pilates', status: 'active' },
};

interface Row {
  id: string;
  room_id: string;
  instructor_id: string;
  class_type_id: string;
  start_time: Date;
  end_time: Date;
  status: ScheduleStatus;
  capacity: number;
}

/**
 * In-memory stand-in for the transaction manager. The overlap query builder
 * collects its bound parameters and evaluates them against `rows`, so the test
 * exercises the real column/status/time/exclude wiring of `findOverlap`.
 */
function fakeManager(rows: Row[]) {
  const byId = (list: Record<string, { id: string }>, id: string) =>
    Object.values(list).find((x) => x.id === id) ?? null;

  const queryBuilder = () => {
    let column = '';
    const params: Record<string, any> = {};
    const qb: any = {
      leftJoinAndSelect: () => qb,
      orderBy: () => qb,
      where: (sql: string, p: object) => {
        column = /s\.(\w+) = :value/.exec(sql)![1];
        Object.assign(params, p);
        return qb;
      },
      andWhere: (_sql: string, p: object) => {
        Object.assign(params, p);
        return qb;
      },
      getOne: async () => {
        const hit = rows
          .filter(
            (s) =>
              (s as any)[column] === params.value &&
              params.statuses.includes(s.status) &&
              s.start_time < params.end &&
              s.end_time > params.start &&
              (!params.excludeId || s.id !== params.excludeId),
          )
          .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())[0];
        if (!hit) return null;
        return {
          ...hit,
          room: byId(rooms, hit.room_id),
          instructor: byId(instructors, hit.instructor_id),
          class_type: byId(classTypes, hit.class_type_id),
        };
      },
    };
    return qb;
  };

  return {
    findOne: jest.fn(async (entity: unknown, opts: { where: { id: string } }) => {
      const id = opts.where.id;
      if (entity === Room) return byId(rooms, id);
      if (entity === Instructor) return byId(instructors, id);
      return rows.find((r) => r.id === id) ?? null;
    }),
    findOneBy: jest.fn(async (entity: unknown, where: { id: string }) =>
      entity === ClassType ? byId(classTypes, where.id) : null,
    ),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (data: any) => ({ id: data.id ?? 'new-id', ...data })),
    getRepository: () => ({ createQueryBuilder: queryBuilder }),
  };
}

function setup(rows: Row[]) {
  const manager = fakeManager(rows);
  const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
  const repo = { findOne: jest.fn(async () => ({ id: 'saved' })) };
  const service = new SchedulesService(repo as any, dataSource as any);
  return { service, manager, dataSource };
}

const existing = (over: Partial<Row>): Row => ({
  id: 'existing',
  room_id: rooms.A.id,
  instructor_id: instructors.jane.id,
  class_type_id: classTypes.ri.id,
  start_time: wib('18:00'),
  end_time: wib('18:50'),
  status: ScheduleStatus.PUBLISHED,
  capacity: 4,
  ...over,
});

const createDto = (over: Record<string, unknown> = {}) =>
  ({
    class_type_id: classTypes.hm.id,
    instructor_id: instructors.sari.id,
    room_id: rooms.A.id,
    start_time: wib('18:45'),
    end_time: wib('19:35'),
    capacity: 4,
    status: ScheduleStatus.PUBLISHED,
    ...over,
  }) as any;

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as ConflictException;
  }
  throw new Error('expected rejection');
}

describe('SchedulesService conflicts', () => {
  it('rejects an overlapping room with a business message and code', async () => {
    const { service } = setup([existing({})]);
    const err = await rejection(service.create(createDto(), 'admin'));
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual({
      message: 'Studio A is already used by Reformer Intermediate from 18:00–18:50 WIB.',
      code: SCHEDULE_ROOM_CONFLICT,
    });
  });

  it('allows a back-to-back session in the same room', async () => {
    const { service, manager } = setup([existing({})]);
    await service.create(createDto({ start_time: wib('18:50'), end_time: wib('19:40') }), 'admin');
    expect(manager.save).toHaveBeenCalled();
  });

  it('rejects an overlapping instructor in another room', async () => {
    const { service } = setup([
      existing({
        class_type_id: classTypes.hm.id,
        start_time: wib('18:30'),
        end_time: wib('19:20'),
      }),
    ]);
    const err = await rejection(
      service.create(
        createDto({
          room_id: rooms.B.id,
          instructor_id: instructors.jane.id,
          start_time: wib('19:00'),
          end_time: wib('20:00'),
        }),
        'admin',
      ),
    );
    expect(err.getResponse()).toEqual({
      message: 'Jane Doe is already assigned to Hot Mat Pilates from 18:30–19:20 WIB.',
      code: SCHEDULE_INSTRUCTOR_CONFLICT,
    });
  });

  it('allows overlapping time with a different room and instructor', async () => {
    const { service, manager } = setup([existing({})]);
    await service.create(createDto({ room_id: rooms.B.id }), 'admin');
    expect(manager.save).toHaveBeenCalled();
  });

  it('ignores cancelled and completed schedules', async () => {
    const { service, manager } = setup([
      existing({ id: 'c1', status: ScheduleStatus.CANCELLED }),
      existing({ id: 'c2', status: ScheduleStatus.COMPLETED }),
    ]);
    await service.create(createDto(), 'admin');
    expect(manager.save).toHaveBeenCalled();
  });

  it('locks the room then the instructor row inside the transaction', async () => {
    const { service, manager, dataSource } = setup([]);
    await service.create(createDto({ room_id: rooms.B.id }), 'admin');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const locked = manager.findOne.mock.calls
      .filter(([, opts]) => (opts as any).lock?.mode === 'pessimistic_write')
      .map(([entity]) => entity);
    expect(locked).toEqual([Room, Instructor]);
  });

  it('does not let a schedule conflict with itself on update', async () => {
    const { service, manager } = setup([existing({})]);
    await service.update('existing', {
      start_time: wib('18:10'),
      end_time: wib('19:00'),
      room_id: rooms.A.id,
      instructor_id: instructors.jane.id,
    } as any);
    expect(manager.save).toHaveBeenCalled();
  });

  it('still rejects an update that collides with another schedule', async () => {
    const { service } = setup([
      existing({}),
      existing({
        id: 'other',
        instructor_id: instructors.sari.id,
        start_time: wib('19:00'),
        end_time: wib('19:50'),
      }),
    ]);
    const err = await rejection(
      service.update('existing', { start_time: wib('18:30'), end_time: wib('19:20') } as any),
    );
    expect((err.getResponse() as { code: string }).code).toBe(SCHEDULE_ROOM_CONFLICT);
  });

  it('re-checks conflicts when a cancelled schedule is reactivated', async () => {
    const { service } = setup([
      existing({}),
      existing({
        id: 'cancelled',
        status: ScheduleStatus.CANCELLED,
        instructor_id: instructors.sari.id,
      }),
    ]);
    const err = await rejection(
      service.update('cancelled', { status: ScheduleStatus.PUBLISHED } as any),
    );
    expect((err.getResponse() as { code: string }).code).toBe(SCHEDULE_ROOM_CONFLICT);
  });
});

describe('SchedulesService time validation', () => {
  it('rejects a 5-minute violation before opening a transaction', async () => {
    const { service, dataSource } = setup([]);
    const err = await rejection(service.create(createDto({ start_time: wib('18:32') }), 'admin'));
    expect((err.getResponse() as { code: string }).code).toBe(SCHEDULE_INVALID_TIME_INCREMENT);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a session crossing WIB midnight', async () => {
    const { service } = setup([]);
    const err = await rejection(
      service.create(
        createDto({
          start_time: wib('23:30'),
          end_time: new Date('2026-10-23T00:20:00+07:00'),
        }),
        'admin',
      ),
    );
    expect((err.getResponse() as { code: string }).code).toBe(SCHEDULE_INVALID_TIME_RANGE);
  });

  it('does not re-validate the 5-minute step of times an update leaves untouched', async () => {
    const { service, manager } = setup([
      existing({ start_time: new Date('2026-10-22T18:02:00+07:00'), end_time: wib('18:50') }),
    ]);
    await service.update('existing', { capacity: 3 } as any);
    expect(manager.save).toHaveBeenCalled();
  });
});
