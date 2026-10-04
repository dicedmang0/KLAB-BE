import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  Booking,
  BookingStatus,
  AttendanceStatus,
  BookingSource,
} from '../bookings/entities/booking.entity';
import { Schedule, ScheduleStatus } from '../schedules/entities/schedule.entity';
import { ClassType } from '../class-types/entities/class-type.entity';
import { MemberStatus } from '../members/entities/member.entity';
import { MembersService } from '../members/members.service';
import { SoftLaunchService } from '../soft-launch/soft-launch.service';
import { WaitlistPromotionService } from '../bookings/waitlist-promotion.service';

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
 * Active positions are always contiguous (1..n): every queue change renumbers.
 * Seats freed by a confirmed cancellation are filled automatically (see
 * BookingsService); the admin promote endpoint is an operational fallback that
 * shares the same eligibility rules and cannot skip an earlier eligible member.
 */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,
    @InjectRepository(Schedule)
    private readonly schedulesRepo: Repository<Schedule>,
    private readonly membersService: MembersService,
    private readonly softLaunchService: SoftLaunchService,
    private readonly promotion: WaitlistPromotionService,
  ) {}

  // ── Member: join ────────────────────────────────────────────────────────────

  /**
   * Joins the waitlist for a full schedule. The schedule lock serialises
   * position assignment; the new entry goes to the back of the (renumbered)
   * active queue. A member already active (booked or waitlisted) on the schedule
   * is rejected by the partial unique index.
   */
  async joinWaitlist(userId: string, scheduleId: string): Promise<WaitlistView> {
    const bookingId = await this.dataSource.transaction(async (manager) => {
      const member = await this.membersService.ensureForUser(manager, userId);
      if (member.status !== MemberStatus.ACTIVE) {
        throw new ForbiddenException('Member account is not active');
      }

      const schedule = await this.promotion.lockSchedule(manager, scheduleId);
      this.promotion.assertPromotable(schedule);

      // Soft launch: in-window classes are exclusive to participants (403 otherwise).
      // Nothing is charged on join either way; promotion re-evaluates the gate.
      await this.softLaunchService.checkBooking(manager, userId, schedule.start_time);

      // Waitlist is only for full schedules — open seats should be booked directly.
      const confirmedCount = await this.promotion.countConfirmed(manager, schedule.id);
      if (confirmedCount < schedule.capacity) {
        throw new BadRequestException(
          'Schedule still has open slots — book directly instead of joining the waitlist',
        );
      }

      const classType = await manager.findOne(ClassType, {
        where: { id: schedule.class_type_id },
      });
      const cost = classType?.credit_cost ?? 0;

      // Back of the active queue; historical promoted/cancelled rows don't count.
      const queueLength = await this.promotion.normalizePositions(manager, schedule.id);

      const booking = manager.create(Booking, {
        booking_code: this.generateBookingCode(),
        member_id: member.id,
        schedule_id: schedule.id,
        status: BookingStatus.WAITLISTED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source: BookingSource.MEMBER,
        credit_cost: cost,
        waitlist_position: queueLength + 1,
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
   * Leaves the waitlist (cancels the waitlisted booking row) and renumbers the
   * rest of the queue. No credit refund — nothing was charged while waitlisted.
   * No promotion: no confirmed seat was released.
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

      // Canonical lock order: schedule → booking.
      await this.promotion.lockSchedule(manager, booking.schedule_id);
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
      locked.waitlist_position = null;
      await manager.save(Booking, locked);

      await this.promotion.normalizePositions(manager, locked.schedule_id);
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
      order: { waitlist_position: 'ASC', created_at: 'ASC', id: 'ASC' },
    });
    return rows.map(toAdminEntryView);
  }

  // ── Admin: promote ────────────────────────────────────────────────────────────

  /**
   * Operational fallback for promoting one entry. Uses the same eligibility
   * rules as automatic fill (active account, credit, soft launch) and only
   * succeeds when the entry is the first eligible member in queue order —
   * otherwise 409 WAITLIST_QUEUE_PRIORITY. 409 when full, 400 when the entry is
   * itself ineligible (403 for soft-launch ineligibility).
   */
  async promote(bookingId: string): Promise<WaitlistView> {
    await this.dataSource.transaction(async (manager) => {
      const entry = await manager.findOne(Booking, { where: { id: bookingId } });
      if (!entry) throw new NotFoundException(`Waitlist entry ${bookingId} not found`);

      const schedule = await this.promotion.lockSchedule(manager, entry.schedule_id);
      const locked = await this.promotion.lockQueueAndMembers(manager, schedule);
      await this.promotion.promoteSpecific(manager, locked, bookingId);
    });

    return this.loadView(bookingId);
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
