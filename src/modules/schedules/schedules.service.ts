import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Schedule, ScheduleStatus } from './entities/schedule.entity';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ClassType, ClassTypeStatus } from '../class-types/entities/class-type.entity';
import { Instructor, InstructorStatus } from '../instructors/entities/instructor.entity';
import { Room, RoomStatus } from '../rooms/entities/room.entity';
import {
  SCHEDULE_INSTRUCTOR_CONFLICT,
  SCHEDULE_ROOM_CONFLICT,
  assertFiveMinuteStep,
  assertSameDayRange,
  wibTime,
} from './schedule-rules';

// Statuses that block a room or instructor slot — cancelled/completed do not.
export const BLOCKING_STATUSES = [ScheduleStatus.DRAFT, ScheduleStatus.PUBLISHED];

interface SlotCheck {
  roomId: string;
  instructorId: string;
  start: Date;
  end: Date;
  excludeId?: string;
}

@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(Schedule)
    private readonly schedulesRepo: Repository<Schedule>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  findAll(): Promise<Schedule[]> {
    return this.schedulesRepo.find({
      relations: ['class_type', 'instructor', 'room'],
      order: { start_time: 'ASC' },
    });
  }

  findById(id: string): Promise<Schedule | null> {
    return this.schedulesRepo.findOne({
      where: { id },
      relations: ['class_type', 'instructor', 'room'],
    });
  }

  async create(dto: CreateScheduleDto, createdBy: string): Promise<Schedule> {
    assertFiveMinuteStep(dto.start_time, 'Start');
    assertFiveMinuteStep(dto.end_time, 'End');
    assertSameDayRange(dto.start_time, dto.end_time);

    const id = await this.dataSource.transaction(async (manager) => {
      await this.requireActiveClassType(manager, dto.class_type_id);
      // Lock order (room → instructor) is fixed so concurrent writers serialise
      // per resource instead of racing past the overlap check.
      const room = await this.requireActiveRoom(manager, dto.room_id);
      await this.requireActiveInstructor(manager, dto.instructor_id);

      this.assertCapacity(dto.capacity, room.capacity);

      if (this.isBlocking(dto.status ?? ScheduleStatus.DRAFT)) {
        await this.assertNoConflicts(manager, {
          roomId: dto.room_id,
          instructorId: dto.instructor_id,
          start: dto.start_time,
          end: dto.end_time,
        });
      }

      const saved = await manager.save(manager.create(Schedule, { ...dto, created_by: createdBy }));
      return saved.id;
    });

    return (await this.findById(id)) as Schedule;
  }

  async update(id: string, dto: UpdateScheduleDto): Promise<Schedule> {
    // Only times being written are checked for the 5-minute step, so editing
    // other fields of a legacy schedule (e.g. 18:32) is not blocked.
    if (dto.start_time) assertFiveMinuteStep(dto.start_time, 'Start');
    if (dto.end_time) assertFiveMinuteStep(dto.end_time, 'End');

    await this.dataSource.transaction(async (manager) => {
      const schedule = await manager.findOne(Schedule, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!schedule) throw new NotFoundException(`Schedule ${id} not found`);

      const effectiveStart = dto.start_time ?? schedule.start_time;
      const effectiveEnd = dto.end_time ?? schedule.end_time;
      if (dto.start_time || dto.end_time) assertSameDayRange(effectiveStart, effectiveEnd);

      if (dto.class_type_id) await this.requireActiveClassType(manager, dto.class_type_id);

      const effectiveRoomId = dto.room_id ?? schedule.room_id;
      const effectiveInstructorId = dto.instructor_id ?? schedule.instructor_id;

      // Changed refs must be active; unchanged ones are only locked.
      const room = dto.room_id
        ? await this.requireActiveRoom(manager, effectiveRoomId)
        : await this.lockRoom(manager, effectiveRoomId);
      if (dto.instructor_id) {
        await this.requireActiveInstructor(manager, effectiveInstructorId);
      } else {
        await this.lockInstructor(manager, effectiveInstructorId);
      }

      // Capacity must fit the effective room (catches room swap + capacity unchanged).
      this.assertCapacity(dto.capacity ?? schedule.capacity, room.capacity);

      // Re-check whenever the result would hold a slot — including a cancelled
      // schedule being reactivated. The schedule never conflicts with itself.
      if (this.isBlocking(dto.status ?? schedule.status)) {
        await this.assertNoConflicts(manager, {
          roomId: effectiveRoomId,
          instructorId: effectiveInstructorId,
          start: effectiveStart,
          end: effectiveEnd,
          excludeId: id,
        });
      }

      Object.assign(schedule, dto);
      await manager.save(schedule);
    });

    return (await this.findById(id)) as Schedule;
  }

  async cancel(id: string): Promise<Schedule> {
    const schedule = await this.schedulesRepo.findOneBy({ id });
    if (!schedule) throw new NotFoundException(`Schedule ${id} not found`);
    schedule.status = ScheduleStatus.CANCELLED;
    await this.schedulesRepo.save(schedule);
    return (await this.findById(id)) as Schedule;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private isBlocking(status: ScheduleStatus): boolean {
    return BLOCKING_STATUSES.includes(status);
  }

  private assertCapacity(scheduleCapacity: number, roomCapacity: number): void {
    if (scheduleCapacity > roomCapacity) {
      throw new BadRequestException(
        `Schedule capacity (${scheduleCapacity}) exceeds room capacity (${roomCapacity})`,
      );
    }
  }

  private async requireActiveClassType(manager: EntityManager, id: string): Promise<ClassType> {
    const ct = await manager.findOneBy(ClassType, { id });
    if (!ct) throw new NotFoundException(`Class type ${id} not found`);
    if (ct.status !== ClassTypeStatus.ACTIVE) {
      throw new BadRequestException(`Class type "${ct.name}" is not active`);
    }
    return ct;
  }

  private async lockRoom(manager: EntityManager, id: string): Promise<Room> {
    const room = await manager.findOne(Room, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!room) throw new NotFoundException(`Room ${id} not found`);
    return room;
  }

  private async requireActiveRoom(manager: EntityManager, id: string): Promise<Room> {
    const room = await this.lockRoom(manager, id);
    if (room.status !== RoomStatus.ACTIVE) {
      throw new BadRequestException(`Room "${room.name}" is not active`);
    }
    return room;
  }

  private async lockInstructor(manager: EntityManager, id: string): Promise<Instructor> {
    const instructor = await manager.findOne(Instructor, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!instructor) throw new NotFoundException(`Instructor ${id} not found`);
    return instructor;
  }

  private async requireActiveInstructor(manager: EntityManager, id: string): Promise<Instructor> {
    const instructor = await this.lockInstructor(manager, id);
    if (instructor.status !== InstructorStatus.ACTIVE) {
      throw new BadRequestException(
        `Instructor "${instructor.first_name} ${instructor.last_name}" is not active`,
      );
    }
    return instructor;
  }

  /**
   * Rejects the slot if the room or instructor already has a blocking schedule
   * overlapping [start, end). Back-to-back sessions (existing.end == new.start)
   * are allowed because both comparisons are strict.
   */
  private async assertNoConflicts(manager: EntityManager, slot: SlotCheck): Promise<void> {
    const roomClash = await this.findOverlap(manager, 'room_id', slot.roomId, slot);
    if (roomClash) {
      throw new ConflictException({
        message: `${roomClash.room?.name ?? 'This room'} is already used by ${this.describe(roomClash)}.`,
        code: SCHEDULE_ROOM_CONFLICT,
      });
    }

    const instructorClash = await this.findOverlap(
      manager,
      'instructor_id',
      slot.instructorId,
      slot,
    );
    if (instructorClash) {
      const name =
        [instructorClash.instructor?.first_name, instructorClash.instructor?.last_name]
          .filter(Boolean)
          .join(' ') || 'This instructor';
      throw new ConflictException({
        message: `${name} is already assigned to ${this.describe(instructorClash)}.`,
        code: SCHEDULE_INSTRUCTOR_CONFLICT,
      });
    }
  }

  private findOverlap(
    manager: EntityManager,
    column: 'room_id' | 'instructor_id',
    value: string,
    slot: SlotCheck,
  ): Promise<Schedule | null> {
    const qb = manager
      .getRepository(Schedule)
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.class_type', 'ct')
      .leftJoinAndSelect('s.room', 'r')
      .leftJoinAndSelect('s.instructor', 'i')
      .where(`s.${column} = :value`, { value })
      .andWhere('s.status IN (:...statuses)', { statuses: BLOCKING_STATUSES })
      .andWhere('s.start_time < :end', { end: slot.end })
      .andWhere('s.end_time > :start', { start: slot.start })
      .orderBy('s.start_time', 'ASC');

    if (slot.excludeId) qb.andWhere('s.id != :excludeId', { excludeId: slot.excludeId });
    return qb.getOne();
  }

  /** "Reformer Intermediate from 18:00–18:50 WIB" */
  private describe(s: Schedule): string {
    const title = s.class_type?.name ?? 'another class';
    return `${title} from ${wibTime(s.start_time)}–${wibTime(s.end_time)} WIB`;
  }
}
