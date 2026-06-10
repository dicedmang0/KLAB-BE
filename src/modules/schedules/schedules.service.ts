import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Schedule, ScheduleStatus } from './entities/schedule.entity';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ClassType, ClassTypeStatus } from '../class-types/entities/class-type.entity';
import { Instructor, InstructorStatus } from '../instructors/entities/instructor.entity';
import { Room, RoomStatus } from '../rooms/entities/room.entity';

// Statuses that block a room or instructor slot — cancelled/completed do not.
const BLOCKING_STATUSES = [ScheduleStatus.DRAFT, ScheduleStatus.PUBLISHED];

@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(Schedule)
    private readonly schedulesRepo: Repository<Schedule>,
    @InjectRepository(ClassType)
    private readonly classTypesRepo: Repository<ClassType>,
    @InjectRepository(Instructor)
    private readonly instructorsRepo: Repository<Instructor>,
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
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
    this.assertTimeRange(dto.start_time, dto.end_time);

    const [, , room] = await Promise.all([
      this.requireActiveClassType(dto.class_type_id),
      this.requireActiveInstructor(dto.instructor_id),
      this.requireActiveRoom(dto.room_id),
    ]);

    this.assertCapacity(dto.capacity, room.capacity);

    await Promise.all([
      this.assertNoRoomOverlap(dto.room_id, dto.start_time, dto.end_time),
      this.assertNoInstructorOverlap(dto.instructor_id, dto.start_time, dto.end_time),
    ]);

    const schedule = this.schedulesRepo.create({ ...dto, created_by: createdBy });
    const saved = await this.schedulesRepo.save(schedule);
    return (await this.findById(saved.id)) as Schedule;
  }

  async update(id: string, dto: UpdateScheduleDto): Promise<Schedule> {
    const schedule = await this.loadForMutation(id);

    const effectiveStart = dto.start_time ?? schedule.start_time;
    const effectiveEnd = dto.end_time ?? schedule.end_time;

    this.assertTimeRange(effectiveStart, effectiveEnd);

    // Validate only the refs that are actually changing.
    let effectiveRoom: Room = schedule.room;

    if (dto.class_type_id) await this.requireActiveClassType(dto.class_type_id);

    if (dto.instructor_id) await this.requireActiveInstructor(dto.instructor_id);

    if (dto.room_id) {
      effectiveRoom = await this.requireActiveRoom(dto.room_id);
    }

    // Capacity must fit the effective room (catches room swap + capacity unchanged).
    const effectiveCapacity = dto.capacity ?? schedule.capacity;
    this.assertCapacity(effectiveCapacity, effectiveRoom.capacity);

    // Overlap checks — only run when the relevant fields change.
    const effectiveRoomId = dto.room_id ?? schedule.room_id;
    const effectiveInstructorId = dto.instructor_id ?? schedule.instructor_id;

    const roomSlotChanged = !!(dto.start_time || dto.end_time || dto.room_id);
    const instructorSlotChanged = !!(dto.start_time || dto.end_time || dto.instructor_id);

    await Promise.all([
      roomSlotChanged
        ? this.assertNoRoomOverlap(effectiveRoomId, effectiveStart, effectiveEnd, id)
        : Promise.resolve(),
      instructorSlotChanged
        ? this.assertNoInstructorOverlap(effectiveInstructorId, effectiveStart, effectiveEnd, id)
        : Promise.resolve(),
    ]);

    Object.assign(schedule, dto);
    const saved = await this.schedulesRepo.save(schedule);
    return (await this.findById(saved.id)) as Schedule;
  }

  async cancel(id: string): Promise<Schedule> {
    const schedule = await this.loadForMutation(id);
    schedule.status = ScheduleStatus.CANCELLED;
    await this.schedulesRepo.save(schedule);
    return (await this.findById(id)) as Schedule;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Loads the schedule with the room relation for mutation methods. */
  private async loadForMutation(id: string): Promise<Schedule> {
    const schedule = await this.schedulesRepo.findOne({
      where: { id },
      relations: ['room'],
    });
    if (!schedule) throw new NotFoundException(`Schedule ${id} not found`);
    return schedule;
  }

  private assertTimeRange(start: Date, end: Date): void {
    if (start >= end) {
      throw new BadRequestException('start_time must be before end_time');
    }
  }

  private assertCapacity(scheduleCapacity: number, roomCapacity: number): void {
    if (scheduleCapacity > roomCapacity) {
      throw new BadRequestException(
        `Schedule capacity (${scheduleCapacity}) exceeds room capacity (${roomCapacity})`,
      );
    }
  }

  private async requireActiveClassType(id: string): Promise<ClassType> {
    const ct = await this.classTypesRepo.findOneBy({ id });
    if (!ct) throw new NotFoundException(`Class type ${id} not found`);
    if (ct.status !== ClassTypeStatus.ACTIVE) {
      throw new BadRequestException(`Class type "${ct.name}" is not active`);
    }
    return ct;
  }

  private async requireActiveInstructor(id: string): Promise<Instructor> {
    const instructor = await this.instructorsRepo.findOneBy({ id });
    if (!instructor) throw new NotFoundException(`Instructor ${id} not found`);
    if (instructor.status !== InstructorStatus.ACTIVE) {
      throw new BadRequestException(
        `Instructor "${instructor.first_name} ${instructor.last_name}" is not active`,
      );
    }
    return instructor;
  }

  private async requireActiveRoom(id: string): Promise<Room> {
    const room = await this.roomsRepo.findOneBy({ id });
    if (!room) throw new NotFoundException(`Room ${id} not found`);
    if (room.status !== RoomStatus.ACTIVE) {
      throw new BadRequestException(`Room "${room.name}" is not active`);
    }
    return room;
  }

  /**
   * Throws ConflictException if the room already has a draft or published
   * schedule that overlaps [startTime, endTime).
   * Two intervals overlap iff  A.start < B.end  AND  A.end > B.start.
   */
  private async assertNoRoomOverlap(
    roomId: string,
    startTime: Date,
    endTime: Date,
    excludeId?: string,
  ): Promise<void> {
    const qb = this.schedulesRepo
      .createQueryBuilder('s')
      .where('s.room_id = :roomId', { roomId })
      .andWhere('s.status IN (:...statuses)', { statuses: BLOCKING_STATUSES })
      .andWhere('s.start_time < :endTime', { endTime })
      .andWhere('s.end_time > :startTime', { startTime });

    if (excludeId) qb.andWhere('s.id != :excludeId', { excludeId });

    const count = await qb.getCount();
    if (count > 0) {
      throw new ConflictException('Room already has a schedule overlapping this time slot');
    }
  }

  /**
   * Throws ConflictException if the instructor already has a draft or published
   * schedule that overlaps [startTime, endTime).
   */
  private async assertNoInstructorOverlap(
    instructorId: string,
    startTime: Date,
    endTime: Date,
    excludeId?: string,
  ): Promise<void> {
    const qb = this.schedulesRepo
      .createQueryBuilder('s')
      .where('s.instructor_id = :instructorId', { instructorId })
      .andWhere('s.status IN (:...statuses)', { statuses: BLOCKING_STATUSES })
      .andWhere('s.start_time < :endTime', { endTime })
      .andWhere('s.end_time > :startTime', { startTime });

    if (excludeId) qb.andWhere('s.id != :excludeId', { excludeId });

    const count = await qb.getCount();
    if (count > 0) {
      throw new ConflictException('Instructor already has a schedule overlapping this time slot');
    }
  }
}
