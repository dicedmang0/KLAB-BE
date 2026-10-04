import { ConflictException, ForbiddenException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { BookingsService } from './bookings.service';
import { WaitlistPromotionService, WAITLIST_QUEUE_PRIORITY } from './waitlist-promotion.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { Booking, BookingSource, BookingStatus, AttendanceStatus } from './entities/booking.entity';
import { Schedule, ScheduleStatus } from '../schedules/entities/schedule.entity';
import { Member, MemberStatus } from '../members/entities/member.entity';
import { ClassType } from '../class-types/entities/class-type.entity';
import { CreditLedger, CreditLedgerType } from '../credits/entities/credit-ledger.entity';
import { CreditsService } from '../credits/credits.service';
import { SoftLaunchService, SOFT_LAUNCH_NOT_ELIGIBLE } from '../soft-launch/soft-launch.service';
import { SoftLaunchParticipant } from '../soft-launch/entities/soft-launch-participant.entity';

/**
 * Service-level tests for automatic waitlist promotion, queue normalisation and
 * manual promotion. The real BookingsService, WaitlistService,
 * WaitlistPromotionService, CreditsService and SoftLaunchService run against an
 * in-memory EntityManager whose transactions roll back on error and which
 * records every row lock, so lock order is asserted too.
 *
 * PostgreSQL row-lock blocking itself is NOT exercised here — see the report;
 * a real-database concurrency smoke is still required.
 */

const NOW = new Date('2026-10-10T10:00:00+07:00').getTime();
const DAY = 24 * 3600 * 1000;

type Row = Record<string, any>;
type EntityClass = { name: string };

class FakeDb {
  tables = new Map<EntityClass, Row[]>([
    [Schedule, []],
    [Booking, []],
    [Member, []],
    [ClassType, []],
    [CreditLedger, []],
    [SoftLaunchParticipant, []],
  ]);
  /** e.g. "Schedule:sch", "Booking:b1,b2", "Member:m-a,m-b" in acquisition order. */
  locks: string[] = [];
  private seq = 0;

  table(e: EntityClass): Row[] {
    const t = this.tables.get(e);
    if (!t) throw new Error(`no fake table for ${e.name}`);
    return t;
  }

  insert(e: EntityClass, row: Row): Row {
    const stored = { created_at: new Date(NOW - DAY + ++this.seq * 1000), ...row };
    this.table(e).push(stored);
    return stored;
  }

  private matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v instanceof FindOperator) {
        if (v.type !== 'in') throw new Error(`unsupported operator ${v.type}`);
        return (v.value as unknown[]).includes(row[k]);
      }
      return row[k] === v;
    });
  }

  private view(e: EntityClass, row: Row, relations: string[] = []): Row {
    const out = { ...row };
    if (relations.includes('member')) {
      const m = this.table(Member).find((x) => x.id === row.member_id);
      out.member = m ? { ...m } : null;
    }
    if (relations.includes('schedule')) {
      const s = this.table(Schedule).find((x) => x.id === row.schedule_id);
      out.schedule = s ? { ...s } : null;
    }
    return out;
  }

  private sort(rows: Row[], order: Row = {}): Row[] {
    const keys = Object.entries(order).map(([k, v]) =>
      typeof v === 'string'
        ? { k, dir: v, nulls: 'LAST' }
        : { k, dir: v.direction, nulls: v.nulls },
    );
    return [...rows].sort((a, b) => {
      for (const { k, dir, nulls } of keys) {
        const av = a[k];
        const bv = b[k];
        if (av == null || bv == null) {
          if (av == null && bv == null) continue;
          const nullFirst = String(nulls).toUpperCase() === 'FIRST';
          return (av == null ? 1 : -1) * (nullFirst ? -1 : 1);
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        if (cmp) return String(dir).toUpperCase() === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });
  }

  manager = {
    findOne: async (e: EntityClass, opts: Row) => {
      const row = this.table(e).find((r) => this.matches(r, opts.where));
      if (opts.lock && row) this.locks.push(`${e.name}:${row.id}`);
      return row ? this.view(e, row, opts.relations) : null;
    },
    findOneBy: async (e: EntityClass, where: Row) => {
      const row = this.table(e).find((r) => this.matches(r, where));
      return row ? { ...row } : null;
    },
    find: async (e: EntityClass, opts: Row) => {
      const rows = this.sort(
        this.table(e).filter((r) => this.matches(r, opts.where)),
        opts.order,
      );
      if (opts.lock) this.locks.push(`${e.name}:${rows.map((r) => r.id).join(',')}`);
      return rows.map((r) => this.view(e, r, opts.relations));
    },
    count: async (e: EntityClass, opts: Row) =>
      this.table(e).filter((r) => this.matches(r, opts.where)).length,
    create: (_e: EntityClass, data: Row) => ({ ...data }),
    save: async (e: EntityClass, entity: Row) => {
      const t = this.table(e);
      const data = { ...entity };
      delete data.member; // relations are not columns
      delete data.schedule;
      if (!data.id) data.id = `${e.name.toLowerCase()}-${++this.seq}`;
      const existing = t.find((r) => r.id === data.id);
      if (existing) Object.assign(existing, data);
      else this.insert(e, data);
      entity.id = data.id;
      return { ...t.find((r) => r.id === data.id) };
    },
  };

  /** Rolls back every table on error, like a real transaction. */
  transaction = async <T>(cb: (m: unknown) => Promise<T>): Promise<T> => {
    const snapshot = new Map([...this.tables].map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
    try {
      return await cb(this.manager);
    } catch (e) {
      this.tables = snapshot;
      throw e;
    }
  };
}

interface WorldOpts {
  capacity?: number;
  startsInMs?: number;
  scheduleStatus?: ScheduleStatus;
  softLaunch?: { start: Date; end: Date };
}

function world(opts: WorldOpts = {}) {
  const db = new FakeDb();
  db.insert(ClassType, { id: 'ct', name: 'Reformer Beginner', credit_cost: 1 });
  db.insert(Schedule, {
    id: 'sch',
    class_type_id: 'ct',
    capacity: opts.capacity ?? 4,
    status: opts.scheduleStatus ?? ScheduleStatus.PUBLISHED,
    is_published: true,
    start_time: new Date(NOW + (opts.startsInMs ?? 2 * DAY)),
    end_time: new Date(NOW + (opts.startsInMs ?? 2 * DAY) + 3000_000),
  });

  const softCfg = opts.softLaunch
    ? { enabled: true, start: opts.softLaunch.start, end: opts.softLaunch.end, quota: 80 }
    : { enabled: false, start: new Date(0), end: new Date(0), quota: 0 };
  const dataSource = { transaction: db.transaction, getRepository: () => ({}) };
  const credits = new CreditsService(dataSource as any);
  const softLaunch = new SoftLaunchService(dataSource as any, { get: () => softCfg } as any);
  const promotion = new WaitlistPromotionService(credits, softLaunch);
  const bookingsRepo = {
    findOne: (opts: Row) => db.manager.findOne(Booking, opts),
    find: (opts: Row) => db.manager.find(Booking, opts),
  };
  const membersService = {
    ensureForUser: async (_m: unknown, userId: string) =>
      db.table(Member).find((m) => m.user_id === userId),
    findByUserId: async (userId: string) => db.table(Member).find((m) => m.user_id === userId),
  };
  const bookings = new BookingsService(
    dataSource as any,
    bookingsRepo as any,
    credits,
    membersService as any,
    { get: () => undefined } as any,
    softLaunch,
    promotion,
  );
  const waitlist = new WaitlistService(
    dataSource as any,
    bookingsRepo as any,
    { findOneBy: (w: Row) => db.manager.findOneBy(Schedule, w) } as any,
    membersService as any,
    softLaunch,
    promotion,
  );

  const member = (name: string, o: { credit?: number; status?: MemberStatus } = {}) =>
    db.insert(Member, {
      id: `m-${name}`,
      user_id: `u-${name}`,
      first_name: name,
      last_name: null,
      credit_balance: o.credit ?? 5,
      status: o.status ?? MemberStatus.ACTIVE,
    });
  const booking = (name: string, status: BookingStatus, extra: Row = {}) =>
    db.insert(Booking, {
      id: `b-${name}`,
      booking_code: `BK-${name}`,
      member_id: `m-${name}`,
      schedule_id: 'sch',
      status,
      attendance_status: AttendanceStatus.NOT_CHECKED_IN,
      source: BookingSource.MEMBER,
      credit_cost: 1,
      credit_ledger_id: status === BookingStatus.CONFIRMED ? `ledger-${name}` : null,
      waitlist_position: null,
      cancelled_at: null,
      ...extra,
    });
  const confirmed = (...names: string[]) =>
    names.forEach((n) => {
      member(n);
      booking(n, BookingStatus.CONFIRMED);
    });
  const waitlisted = (
    name: string,
    position: number,
    o: { credit?: number; status?: MemberStatus } = {},
  ) => {
    member(name, o);
    booking(name, BookingStatus.WAITLISTED, { waitlist_position: position });
  };
  const participant = (name: string) =>
    db.insert(SoftLaunchParticipant, {
      id: `p-${name}`,
      user_id: `u-${name}`,
      code: `KLAB-SL-${name}`,
    });

  const row = (name: string) => db.table(Booking).find((b) => b.id === `b-${name}`)!;
  const balance = (name: string) =>
    db.table(Member).find((m) => m.id === `m-${name}`)!.credit_balance;
  const state = () => {
    const rows = db.table(Booking).filter((b) => b.schedule_id === 'sch');
    return {
      confirmed: rows
        .filter((b) => b.status === BookingStatus.CONFIRMED)
        .map((b) => b.member_id.slice(2))
        .sort(),
      waitlist: rows
        .filter((b) => b.status === BookingStatus.WAITLISTED)
        .sort((a, b) => a.waitlist_position - b.waitlist_position)
        .map((b) => `#${b.waitlist_position} ${b.member_id.slice(2)}`),
    };
  };
  const debits = (name: string) =>
    db
      .table(CreditLedger)
      .filter((l) => l.member_id === `m-${name}` && l.type === CreditLedgerType.BOOKING_DEBIT);

  return {
    db,
    bookings,
    waitlist,
    softLaunch,
    member,
    booking,
    confirmed,
    waitlisted,
    participant,
    row,
    balance,
    state,
    debits,
  };
}

async function rejection(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected rejection');
}

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe('automatic promotion after a confirmed cancellation', () => {
  it('fills both seats from the front of the queue (screenshot case)', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('Kirana', 1);
    w.waitlisted('Megan', 2);
    w.waitlisted('Jess', 3);

    await w.bookings.cancelAny('b-A', 'admin');
    await w.bookings.cancelOwn('u-B', 'b-B');

    expect(w.state()).toEqual({
      confirmed: ['C', 'D', 'Kirana', 'Megan'],
      waitlist: ['#1 Jess'],
    });
    expect(w.row('Kirana').waitlist_position).toBeNull();
    expect(w.row('Megan').waitlist_position).toBeNull();
    expect(w.row('A').waitlist_position).toBeNull();
  });

  it('fills every free seat in one run, not just one', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C'); // 3/4 — one seat already free (e.g. capacity was raised)
    w.waitlisted('E', 1);
    w.waitlisted('F', 2);
    w.waitlisted('G', 3);

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.state()).toEqual({ confirmed: ['B', 'C', 'E', 'F'], waitlist: ['#1 G'] });
  });

  it('skips an insufficient-credit #1 without rolling back the cancellation', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('Kirana', 1, { credit: 0 });
    w.waitlisted('Megan', 2);
    w.waitlisted('Jess', 3);

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.row('A').status).toBe(BookingStatus.CANCELLED);
    expect(w.state()).toEqual({
      confirmed: ['B', 'C', 'D', 'Megan'],
      waitlist: ['#1 Kirana', '#2 Jess'],
    });
    expect(w.row('Megan').waitlist_position).toBeNull();
    expect(w.balance('Kirana')).toBe(0);
    expect(w.debits('Kirana')).toHaveLength(0);
  });

  it('skips a suspended #1 and promotes #2', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('S', 1, { status: MemberStatus.SUSPENDED });
    w.waitlisted('T', 2);

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.state()).toEqual({ confirmed: ['B', 'C', 'D', 'T'], waitlist: ['#1 S'] });
  });

  it('two-seat skip scenario: promotes #2 and #4, renumbers #1/#3/#5', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('w1', 1, { credit: 0 });
    w.waitlisted('w2', 2);
    w.waitlisted('w3', 3, { status: MemberStatus.SUSPENDED });
    w.waitlisted('w4', 4);
    w.waitlisted('w5', 5);

    await w.bookings.cancelAny('b-A', 'admin');
    await w.bookings.cancelAny('b-B', 'admin');

    expect(w.state()).toEqual({
      confirmed: ['C', 'D', 'w2', 'w4'],
      waitlist: ['#1 w1', '#2 w3', '#3 w5'],
    });
  });

  it('charges a normal promotion exactly once and leaves the canceller refund intact', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('Megan', 1, { credit: 3 });

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.balance('Megan')).toBe(2);
    expect(w.debits('Megan')).toHaveLength(1);
    expect(w.row('Megan').credit_ledger_id).toBe(w.debits('Megan')[0].id);
    // ≥ 12h before class → canceller refunded per the unchanged policy.
    expect(w.balance('A')).toBe(6);
  });

  it('still fills the seat on a late (<12h, forfeited) cancellation', async () => {
    const w = world({ startsInMs: 6 * 3600 * 1000 });
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('Megan', 1);

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.balance('A')).toBe(5); // no refund
    expect(w.state().confirmed).toContain('Megan');
  });

  it('never exceeds capacity: a direct booking after the fill is rejected as full', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('E', 1);
    w.member('Z');

    await w.bookings.cancelAny('b-A', 'admin');
    const err = await rejection(w.bookings.createForMember('u-Z', { schedule_id: 'sch' } as any));

    expect(err).toBeInstanceOf(ConflictException);
    expect(w.state().confirmed).toHaveLength(4);
  });

  it('does not promote into a class that has already started', async () => {
    const w = world({ startsInMs: -3600 * 1000 });
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('E', 1);

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.row('A').status).toBe(BookingStatus.CANCELLED);
    expect(w.state()).toEqual({ confirmed: ['B', 'C', 'D'], waitlist: ['#1 E'] });
  });

  it('does not promote into a cancelled schedule', async () => {
    const w = world({ scheduleStatus: ScheduleStatus.CANCELLED });
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('E', 1);

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.state().waitlist).toEqual(['#1 E']);
  });

  it('surfaces unexpected errors and rolls the whole cancellation back', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('E', 1);
    jest.spyOn(w.softLaunch, 'checkBooking').mockRejectedValue(new Error('connection reset'));

    await expect(w.bookings.cancelAny('b-A', 'admin')).rejects.toThrow('connection reset');

    expect(w.row('A').status).toBe(BookingStatus.CONFIRMED);
    expect(w.row('E').status).toBe(BookingStatus.WAITLISTED);
  });

  it('locks schedule → booking rows → members (one ascending-id batch)', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('Megan', 1);
    w.waitlisted('Jess', 2);

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.db.locks.slice(0, 4)).toEqual([
      'Schedule:sch',
      'Booking:b-A',
      'Booking:b-Megan,b-Jess',
      'Member:m-A,m-Jess,m-Megan',
    ]);
  });
});

describe('waitlist cancellation', () => {
  it('renumbers the queue and promotes nobody when a waitlisted member leaves', async () => {
    const w = world();
    w.confirmed('X', 'Y', 'Z'); // a seat is free, but no confirmed seat was released
    w.waitlisted('A', 1);
    w.waitlisted('B', 2);
    w.waitlisted('C', 3);

    await w.waitlist.leaveWaitlist('u-B', 'b-B');

    expect(w.row('B').status).toBe(BookingStatus.CANCELLED);
    expect(w.row('B').waitlist_position).toBeNull();
    expect(w.state()).toEqual({ confirmed: ['X', 'Y', 'Z'], waitlist: ['#1 A', '#2 C'] });
  });

  it('renumbers when an admin removes a waitlist entry', async () => {
    const w = world();
    w.confirmed('X', 'Y', 'Z', 'W');
    w.waitlisted('Kirana', 1);
    w.waitlisted('Megan', 2);
    w.waitlisted('Jess', 3);

    await w.bookings.cancelAny('b-Kirana', 'admin');

    expect(w.row('Kirana').waitlist_position).toBeNull();
    expect(w.state().waitlist).toEqual(['#1 Megan', '#2 Jess']);
  });

  it('locks the schedule before the entry when leaving (no opposite-order path)', async () => {
    const w = world();
    w.confirmed('X', 'Y', 'Z', 'W');
    w.waitlisted('A', 1);

    await w.waitlist.leaveWaitlist('u-A', 'b-A');

    expect(w.db.locks.slice(0, 2)).toEqual(['Schedule:sch', 'Booking:b-A']);
  });
});

describe('joining the waitlist', () => {
  it('appends at active-queue length + 1, ignoring historical positions', async () => {
    const w = world();
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('E', 1);
    w.waitlisted('F', 5); // legacy gap
    w.booking('A', BookingStatus.CONFIRMED, { id: 'b-old', waitlist_position: 7 });
    w.member('N');

    const view = await w.waitlist.joinWaitlist('u-N', 'sch');

    expect(view.waitlist_position).toBe(3);
    expect(w.state().waitlist).toEqual(['#1 E', '#2 F', '#3 N']);
  });
});

describe('manual promotion', () => {
  it('rejects skipping an earlier eligible member, then allows it once #1 is ineligible', async () => {
    const w = world();
    w.confirmed('X', 'Y', 'Z');
    w.waitlisted('A', 1);
    w.waitlisted('B', 2);

    const err = await rejection(w.waitlist.promote('b-B'));
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual({
      message: 'Another eligible member is ahead in the waitlist.',
      code: WAITLIST_QUEUE_PRIORITY,
    });

    w.db.table(Member).find((m) => m.id === 'm-A')!.credit_balance = 0;
    const view = await w.waitlist.promote('b-B');

    expect(view.status).toBe(BookingStatus.CONFIRMED);
    expect(view.waitlist_position).toBeNull();
    expect(w.state().waitlist).toEqual(['#1 A']);
  });

  it('refuses a suspended member', async () => {
    const w = world();
    w.confirmed('X', 'Y', 'Z');
    w.waitlisted('A', 1, { status: MemberStatus.SUSPENDED });

    const err = await rejection(w.waitlist.promote('b-A'));

    expect(err.message).toBe('Member account is not active');
    expect(w.row('A').status).toBe(BookingStatus.WAITLISTED);
  });

  it('cannot promote the same entry twice or into a full class', async () => {
    const w = world();
    w.confirmed('X', 'Y', 'Z');
    w.waitlisted('A', 1);
    w.waitlisted('B', 2);

    await w.waitlist.promote('b-A');
    expect(await rejection(w.waitlist.promote('b-A'))).toBeInstanceOf(ConflictException);
    const full = await rejection(w.waitlist.promote('b-B'));
    expect(full.message).toBe('Schedule is full');
    expect(w.debits('A')).toHaveLength(1);
    expect(w.state().confirmed).toHaveLength(4);
  });

  it('charges nothing when the entry itself lacks credit', async () => {
    const w = world();
    w.confirmed('X', 'Y', 'Z');
    w.waitlisted('A', 1, { credit: 0 });

    const err = await rejection(w.waitlist.promote('b-A'));

    expect(err.message).toBe('Member has insufficient credit balance to be promoted');
    expect(w.debits('A')).toHaveLength(0);
    expect(w.row('A').status).toBe(BookingStatus.WAITLISTED);
  });
});

describe('soft-launch promotion', () => {
  const active = { start: new Date(NOW - DAY), end: new Date(NOW + 5 * DAY) };

  it('A: in-window eligible participant is promoted free as soft_launch', async () => {
    const w = world({ softLaunch: active });
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('P', 1, { credit: 0 });
    w.participant('P');

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.row('P')).toMatchObject({
      status: BookingStatus.CONFIRMED,
      credit_cost: 0,
      source: BookingSource.SOFT_LAUNCH,
      waitlist_position: null,
    });
    expect(w.debits('P')).toHaveLength(0);
  });

  it('B: in-window non-participant is skipped for the next participant', async () => {
    const w = world({ softLaunch: active });
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('N', 1);
    w.waitlisted('P', 2);
    w.participant('P');

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.state()).toEqual({ confirmed: ['B', 'C', 'D', 'P'], waitlist: ['#1 N'] });
  });

  it('B (manual): an in-window non-participant entry is refused with the soft-launch code', async () => {
    const w = world({ softLaunch: active });
    w.confirmed('X', 'Y', 'Z');
    w.waitlisted('N', 1);

    const err = await rejection(w.waitlist.promote('b-N'));

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().code).toBe(SOFT_LAUNCH_NOT_ELIGIBLE);
  });

  it('C: after the window ends, a participant is charged normal credits', async () => {
    const w = world({ softLaunch: { start: new Date(NOW - 5 * DAY), end: new Date(NOW - DAY) } });
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('P', 1, { credit: 2 });
    w.participant('P');

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.row('P')).toMatchObject({
      status: BookingStatus.CONFIRMED,
      credit_cost: 1,
      source: BookingSource.MEMBER,
    });
    expect(w.balance('P')).toBe(1);
  });

  it('D: after the window, insufficient credit is skipped for the next eligible member', async () => {
    const w = world({ softLaunch: { start: new Date(NOW - 5 * DAY), end: new Date(NOW - DAY) } });
    w.confirmed('A', 'B', 'C', 'D');
    w.waitlisted('P', 1, { credit: 0 });
    w.participant('P');
    w.waitlisted('Q', 2);

    await w.bookings.cancelAny('b-A', 'admin');

    expect(w.state()).toEqual({ confirmed: ['B', 'C', 'D', 'Q'], waitlist: ['#1 P'] });
  });
});
