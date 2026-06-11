import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Schedule, ScheduleStatus } from '../schedules/entities/schedule.entity';
import { ClassType, ClassTypeStatus } from '../class-types/entities/class-type.entity';
import { Package, PackageStatus } from '../packages/entities/package.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';

// ── Public view interfaces ───────────────────────────────────────────────────
// Only fields the FE user / guest needs — no internal admin data.

export interface PublicClassTypeView {
  id: string;
  name: string;
  category: string | null;
  level: string | null;
  duration_minutes: number;
  description: string | null;
  credit_cost: number;
  image_url: string | null;
}

export interface PublicPackageView {
  id: string;
  name: string;
  description: string | null;
  price_idr: number;
  credit_amount: number;
  is_unlimited: boolean;
  validity_days: number;
}

export interface PublicScheduleView {
  id: string;
  start_time: Date;
  end_time: Date;
  capacity: number;
  available_slots: number;
  is_full: boolean;
  class_type: {
    id: string;
    name: string;
    category: string | null;
    level: string | null;
    duration_minutes: number;
    credit_cost: number;
    image_url: string | null;
  };
  instructor: {
    id: string;
    first_name: string;
    last_name: string;
    specialization: string | null;
    bio: string | null;
  };
  room: {
    id: string;
    name: string;
  };
}

// ── Projection helpers ───────────────────────────────────────────────────────

function toPublicClassTypeView(ct: ClassType): PublicClassTypeView {
  return {
    id: ct.id,
    name: ct.name,
    category: ct.category ?? null,
    level: ct.level ?? null,
    duration_minutes: ct.duration_minutes,
    description: ct.description ?? null,
    credit_cost: ct.credit_cost,
    image_url: ct.image_url ?? null,
  };
}

function toPublicPackageView(pkg: Package): PublicPackageView {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description ?? null,
    price_idr: pkg.price_idr,
    credit_amount: pkg.credit_amount,
    is_unlimited: pkg.is_unlimited,
    validity_days: pkg.validity_days,
  };
}

function toPublicScheduleView(schedule: Schedule, confirmedCount: number): PublicScheduleView {
  const available_slots = Math.max(0, schedule.capacity - confirmedCount);
  return {
    id: schedule.id,
    start_time: schedule.start_time,
    end_time: schedule.end_time,
    capacity: schedule.capacity,
    available_slots,
    is_full: available_slots === 0,
    class_type: {
      id: schedule.class_type.id,
      name: schedule.class_type.name,
      category: schedule.class_type.category ?? null,
      level: schedule.class_type.level ?? null,
      duration_minutes: schedule.class_type.duration_minutes,
      credit_cost: schedule.class_type.credit_cost,
      image_url: schedule.class_type.image_url ?? null,
    },
    instructor: {
      id: schedule.instructor.id,
      first_name: schedule.instructor.first_name,
      last_name: schedule.instructor.last_name,
      specialization: schedule.instructor.specialization ?? null,
      bio: schedule.instructor.bio ?? null,
    },
    room: {
      id: schedule.room.id,
      name: schedule.room.name,
    },
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Schedule)
    private readonly schedulesRepo: Repository<Schedule>,
    @InjectRepository(ClassType)
    private readonly classTypesRepo: Repository<ClassType>,
    @InjectRepository(Package)
    private readonly packagesRepo: Repository<Package>,
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,
  ) {}

  // ── Class types ────────────────────────────────────────────────────────────

  async findPublishedClassTypes(): Promise<PublicClassTypeView[]> {
    const rows = await this.classTypesRepo.find({
      where: { status: ClassTypeStatus.ACTIVE, is_published: true },
      order: { name: 'ASC' },
    });
    return rows.map(toPublicClassTypeView);
  }

  async findPublishedClassTypeById(id: string): Promise<PublicClassTypeView> {
    const ct = await this.classTypesRepo.findOne({
      where: { id, status: ClassTypeStatus.ACTIVE, is_published: true },
    });
    if (!ct) throw new NotFoundException(`Class type ${id} not found`);
    return toPublicClassTypeView(ct);
  }

  // ── Packages ───────────────────────────────────────────────────────────────

  async findPublishedPackages(): Promise<PublicPackageView[]> {
    const rows = await this.packagesRepo.find({
      where: { status: PackageStatus.ACTIVE, is_published: true },
      order: { name: 'ASC' },
    });
    return rows.map(toPublicPackageView);
  }

  async findPublishedPackageById(id: string): Promise<PublicPackageView> {
    const pkg = await this.packagesRepo.findOne({
      where: { id, status: PackageStatus.ACTIVE, is_published: true },
    });
    if (!pkg) throw new NotFoundException(`Package ${id} not found`);
    return toPublicPackageView(pkg);
  }

  // ── Schedules ──────────────────────────────────────────────────────────────

  async findPublishedSchedules(): Promise<PublicScheduleView[]> {
    const schedules = await this.schedulesRepo.find({
      where: { status: ScheduleStatus.PUBLISHED, is_published: true },
      relations: ['class_type', 'instructor', 'room'],
      order: { start_time: 'ASC' },
    });

    if (schedules.length === 0) return [];

    const ids = schedules.map((s) => s.id);
    const counts: { schedule_id: string; confirmed_count: string }[] = await this.bookingsRepo
      .createQueryBuilder('b')
      .select('b.schedule_id', 'schedule_id')
      .addSelect('COUNT(*)', 'confirmed_count')
      .where('b.schedule_id IN (:...ids)', { ids })
      .andWhere('b.status = :status', { status: BookingStatus.CONFIRMED })
      .groupBy('b.schedule_id')
      .getRawMany();

    const countMap = new Map(counts.map((c) => [c.schedule_id, parseInt(c.confirmed_count, 10)]));
    return schedules.map((s) => toPublicScheduleView(s, countMap.get(s.id) ?? 0));
  }

  async findPublishedScheduleById(id: string): Promise<PublicScheduleView> {
    const schedule = await this.schedulesRepo.findOne({
      where: { id, status: ScheduleStatus.PUBLISHED, is_published: true },
      relations: ['class_type', 'instructor', 'room'],
    });
    if (!schedule) throw new NotFoundException(`Schedule ${id} not found`);

    const confirmedCount = await this.bookingsRepo.count({
      where: { schedule_id: id, status: BookingStatus.CONFIRMED },
    });

    return toPublicScheduleView(schedule, confirmedCount);
  }
}
