import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import {
  Booking,
  BookingStatus,
  AttendanceStatus,
  BookingSource,
} from '../bookings/entities/booking.entity';
import { Schedule, ScheduleStatus } from '../schedules/entities/schedule.entity';
import { ClassType } from '../class-types/entities/class-type.entity';
import { Member, MemberStatus } from '../members/entities/member.entity';
import { CreditLedgerType } from '../credits/entities/credit-ledger.entity';
import { CreditsService } from '../credits/credits.service';
import { MembersService } from '../members/members.service';

const PG_UNIQUE_VIOLATION = '23505';

/** Member-facing waitlist projection (a waitlist entry is a booking row). */
export interface WaitlistView {
  id: string;
  booking_code: string;
  schedule_id: string;
  status: BookingStatus;
  waitlist_position: number | null;
  credit_cost: number;
  created_at: Date;
  schedule: {
    id: string;
    start_time: Date;
    end_time: Date;
    status: ScheduleStatus;
  } | null;
}

/** Admin schedule-waitlist entry — includes a member summary for the queue view. */
export interface AdminWaitlistEntryView {
  id: string;
  booking_code: string;
  member: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
  status: BookingStatus;
  waitlist_position: number | null;
  credit_cost: number;
  created_at: Date;
}

function toWaitlistView(b: Booking): WaitlistView {
  return {
    id: b.id,
    booking_code: b.booking_code,
    schedule_id: b.schedule_id,
    status: b.status,
    waitlist_position: b.waitlist_position ?? null,
    credit_cost: b.credit_cost,
    created_at: b.created_at,
    schedule: b.schedule
      ? {
          id: b.schedule.id,
          start_time: b.schedule.start_time,
          end_time: b.schedule.end_time,
          status: b.schedule.status,
        }
      : null,
  };
}

function toAdminEntryView(b: Booking): AdminWaitlistEntryView {
  return {
    id: b.id,
    booking_code: b.booking_code,
    member: b.member
      ? {
          id: b.member.id,
          first_name: b.member.first_name ?? null,
          last_name: b.member.last_name ?? null,
          email: b.member.email ?? null,
        }
      : null,
    status: b.status,
    waitlist_position: b.waitlist_position ?? null,
    credit_cost: b.credit_cost,
    created_at: b.created_at,
  };
}

/**
 * Waitlist behaviour, modelled on the existing bookings table: a waitlist entry
 * is a Booking row with status='waitlisted' and a waitlist_position. No credit is
 * charged until an entry is promoted to a confirmed booking. The partial unique
 * index UX_bookings_active_member_schedule guarantees a member cannot hold both an
 * active booking and a waitlist entry for the same schedule.
 *
 * This service never mutates the normal booking-creation or cancellation flows in
 * BookingsService — promotion here is manual/admin-only.
 */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,
    @InjectRepository(Schedule)
    private readonly schedulesRepo: Repository<Schedule>,
    private readonly creditsService: CreditsService,
    private readonly membersService: MembersService,
  ) {}

  // ── Member: join ────────────────────────────────────────────────────────────

  /**
   * Joins the waitlist for a full schedule. Mirrors the booking-creation lock
   * order (schedule FOR UPDATE) so position assignment is serialised per schedule.
   * A member already active (booked or waitlisted) on the schedule is rejected by
   * the partial unique index.
   */
  async joinWaitlist(userId: string, scheduleId: string): Promise<WaitlistView> {
    const bookingId = await this.dataSource.transaction(async (manager) => {
      const member = await this.membersService.ensureForUser(manager, userId);
      if (member.status !== MemberStatus.ACTIVE) {
        throw new ForbiddenException('Member account is not active');
      }

      const schedule = await manager.findOne(Schedule, {
        where: { id: scheduleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!schedule) throw new NotFoundException(`Schedule ${scheduleId} not found`);
      this.assertWaitlistable(schedule);

      // Waitlist is only for full schedules — open seats should be booked directly.
      const confirmedCount = await manager.count(Booking, {
        where: { schedule_id: schedule.id, status: BookingStatus.CONFIRMED },
      });
      if (confirmedCount < schedule.capacity) {
        throw new BadRequestException(
          'Schedule still has open slots — book directly instead of joining the waitlist',
        );
      }

      const classType = await manager.findOne(ClassType, {
        where: { id: schedule.class_type_id },
      });
      const cost = classType?.credit_cost ?? 0;

      const nextPosition = await this.nextWaitlistPosition(manager, schedule.id);

      const booking = manager.create(Booking, {
        booking_code: this.generateBookingCode(),
        member_id: member.id,
        schedule_id: schedule.id,
        status: BookingStatus.WAITLISTED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source: BookingSource.MEMBER,
        credit_cost: cost,
        waitlist_position: nextPosition,
      });

      let saved: Booking;
      try {
        saved = await manager.save(Booking, booking);
      } catch (e) {
        throw this.mapInsertError(e);
      }
      return saved.id;
    });

    return this.loadView(bookingId);
  }

  // ── Member: list own ──────────────────────────────────────────────────────────

  async findOwnWaitlist(userId: string): Promise<WaitlistView[]> {
    const member = await this.membersService.findByUserId(userId);
    if (!member) return [];
    const rows = await this.bookingsRepo.find({
      where: { member_id: member.id, status: BookingStatus.WAITLISTED },
      relations: ['schedule'],
      order: { waitlist_position: 'ASC' },
    });
    return rows.map(toWaitlistView);
  }

  // ── Member: leave ─────────────────────────────────────────────────────────────

  /**
   * Leaves the waitlist (cancels the waitlisted booking row). No credit refund —
   * nothing was charged while waitlisted.
   */
  async leaveWaitlist(userId: string, bookingId: string): Promise<WaitlistView> {
    await this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId },
        relations: ['member'],
      });
      if (!booking) throw new NotFoundException(`Waitlist entry ${bookingId} not found`);
      if (booking.member?.user_id !== userId) {
        throw new ForbiddenException('You can only leave your own waitlist');
      }

      const locked = await manager.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException(`Waitlist entry ${bookingId} not found`);
      if (locked.status !== BookingStatus.WAITLISTED) {
        throw new ConflictException(`Not an active waitlist entry (status: ${locked.status})`);
      }

      locked.status = BookingStatus.CANCELLED;
      locked.cancelled_at = new Date();
      await manager.save(Booking, locked);
    });

    return this.loadView(bookingId);
  }

  // ── Admin: list a schedule's waitlist ─────────────────────────────────────────

  async findScheduleWaitlist(scheduleId: string): Promise<AdminWaitlistEntryView[]> {
    const schedule = await this.schedulesRepo.findOneBy({ id: scheduleId });
    if (!schedule) throw new NotFoundException(`Schedule ${scheduleId} not found`);

    const rows = await this.bookingsRepo.find({
      where: { schedule_id: scheduleId, status: BookingStatus.WAITLISTED },
      relations: ['member'],
      order: { waitlist_position: 'ASC' },
    });
    return rows.map(toAdminEntryView);
  }

  // ── Admin: promote ────────────────────────────────────────────────────────────

  /**
   * Promotes a waitlisted booking to confirmed, atomically and only if capacity
   * allows. Debits the member's credit (the snapshot taken at join time) exactly
   * like a normal booking. Lock order schedule → booking → member matches the
   * booking-creation path to avoid deadlocks. Rejects with 400 if the member
   * cannot cover the credit cost.
   */
  async promote(bookingId: string): Promise<WaitlistView> {
    const promotedId = await this.dataSource.transaction(async (manager) => {
      const entry = await manager.findOne(Booking, { where: { id: bookingId } });
      if (!entry) throw new NotFoundException(`Waitlist entry ${bookingId} not found`);

      const schedule = await manager.findOne(Schedule, {
        where: { id: entry.schedule_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!schedule) throw new NotFoundException(`Schedule ${entry.schedule_id} not found`);
      this.assertWaitlistable(schedule);

      const locked = await manager.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException(`Waitlist entry ${bookingId} not found`);
      if (locked.status !== BookingStatus.WAITLISTED) {
        throw new ConflictException(`Booking is not on the waitlist (status: ${locked.status})`);
      }

      const confirmedCount = await manager.count(Booking, {
        where: { schedule_id: schedule.id, status: BookingStatus.CONFIRMED },
      });
      if (confirmedCount >= schedule.capacity) {
        throw new ConflictException('Schedule is full');
      }

      const member = await manager.findOne(Member, {
        where: { id: locked.member_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) throw new NotFoundException('Member not found');

      const cost = locked.credit_cost;
      if (cost > 0 && member.credit_balance < cost) {
        throw new BadRequestException('Member has insufficient credit balance to be promoted');
      }

      locked.status = BookingStatus.CONFIRMED;
      let saved = await manager.save(Booking, locked);

      if (cost > 0) {
        const ledger = await this.creditsService.applyDelta(manager, member, -cost, {
          type: CreditLedgerType.BOOKING_DEBIT,
          bookingId: saved.id,
          reason: `Waitlist promotion ${saved.booking_code}`,
        });
        saved.credit_ledger_id = ledger.id;
        saved = await manager.save(Booking, saved);
      }

      return saved.id;
    });

    return this.loadView(promotedId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async loadView(id: string): Promise<WaitlistView> {
    const booking = await this.bookingsRepo.findOne({
      where: { id },
      relations: ['schedule'],
    });
    if (!booking) throw new NotFoundException(`Waitlist entry ${id} not found`);
    return toWaitlistView(booking);
  }

  /**
   * Next position = highest position among currently-waitlisted rows for the
   * schedule + 1. Promoted/left rows leave their status (no longer 'waitlisted')
   * so they drop out of this MAX; gaps are acceptable since position is only an
   * ordering hint and is never uniqueness-constrained.
   */
  private async nextWaitlistPosition(manager: EntityManager, scheduleId: string): Promise<number> {
    const res = await manager
      .createQueryBuilder(Booking, 'b')
      .select('MAX(b.waitlist_position)', 'max')
      .where('b.schedule_id = :scheduleId', { scheduleId })
      .andWhere('b.status = :status', { status: BookingStatus.WAITLISTED })
      .getRawOne<{ max: number | string | null }>();
    const max = res?.max == null ? 0 : Number(res.max);
    return max + 1;
  }

  private assertWaitlistable(schedule: Schedule): void {
    if (schedule.status !== ScheduleStatus.PUBLISHED || !schedule.is_published) {
      throw new BadRequestException('Schedule is not open for booking');
    }
    if (new Date(schedule.start_time).getTime() <= Date.now()) {
      throw new BadRequestException('Schedule has already started');
    }
  }

  private generateBookingCode(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BK-${ts}${rand}`;
  }

  private mapInsertError(e: unknown): Error {
    if (e instanceof QueryFailedError && (e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return new ConflictException(
        'You already have an active booking or waitlist entry for this schedule',
      );
    }
    return e instanceof Error ? e : new Error('Unknown error joining waitlist');
  }
}
