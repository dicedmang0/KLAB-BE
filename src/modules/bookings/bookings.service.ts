import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { Booking, BookingStatus, AttendanceStatus, BookingSource } from './entities/booking.entity';
import { Schedule, ScheduleStatus } from '../schedules/entities/schedule.entity';
import { ClassType } from '../class-types/entities/class-type.entity';
import { Member, MemberStatus } from '../members/entities/member.entity';
import { CreditLedgerType } from '../credits/entities/credit-ledger.entity';
import { CreditsService } from '../credits/credits.service';
import { MembersService } from '../members/members.service';
import { SoftLaunchService } from '../soft-launch/soft-launch.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { AdminCreateBookingDto } from './dto/admin-create-booking.dto';
import { WaitlistPromotionService } from './waitlist-promotion.service';
import { ListBookingsDto } from './dto/list-bookings.dto';

const CANCELLABLE_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.WAITLISTED,
];

const DEFAULT_CANCELLATION_WINDOW_HOURS = 12;
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,
    private readonly creditsService: CreditsService,
    private readonly membersService: MembersService,
    private readonly config: ConfigService,
    private readonly softLaunchService: SoftLaunchService,
    private readonly waitlistPromotion: WaitlistPromotionService,
  ) {}

  // ── Reads ───────────────────────────────────────────────────────────────

  /**
   * Returns a booking's full detail (with nested schedule relations) if and only
   * if it belongs to the requesting user. The member_id filter in the WHERE clause
   * is the ownership gate — a booking that exists but belongs to a different member
   * returns null, which becomes a 404 (not a 403), preventing enumeration.
   */
  async findOwnDetail(userId: string, bookingId: string): Promise<Booking> {
    const member = await this.membersService.findByUserId(userId);
    // No member row yet → the user has no bookings → 404 is correct.
    if (!member) throw new NotFoundException(`Booking ${bookingId} not found`);

    const booking = await this.bookingsRepo.findOne({
      where: { id: bookingId, member_id: member.id },
      relations: ['schedule', 'schedule.class_type', 'schedule.instructor', 'schedule.room'],
    });
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`);
    return booking;
  }

  async findOwn(userId: string): Promise<Booking[]> {
    const member = await this.membersService.findByUserId(userId);
    if (!member) return [];
    return this.bookingsRepo.find({
      where: { member_id: member.id },
      relations: ['schedule'],
      order: { created_at: 'DESC' },
    });
  }

  findAll(filter: ListBookingsDto): Promise<Booking[]> {
    const where: Record<string, unknown> = {};
    if (filter.schedule_id) where.schedule_id = filter.schedule_id;
    if (filter.member_id) where.member_id = filter.member_id;
    if (filter.status) where.status = filter.status;
    if (filter.source) where.source = filter.source;
    return this.bookingsRepo.find({
      where,
      relations: ['member', 'schedule'],
      order: { created_at: 'DESC' },
    });
  }

  async findDetail(id: string): Promise<Booking> {
    const booking = await this.bookingsRepo.findOne({
      where: { id },
      relations: ['member', 'schedule'],
    });
    if (!booking) throw new NotFoundException(`Booking ${id} not found`);
    return booking;
  }

  // ── Member booking creation ──────────────────────────────────────────────

  /**
   * Creates a confirmed booking and debits credit in a single transaction.
   *
   * Concurrency:
   *  - the schedule row is locked FOR UPDATE before the confirmed-count check,
   *    serialising capacity decisions per schedule (no overbooking);
   *  - the member row is locked FOR UPDATE, serialising credit changes per
   *    member (no double-spend);
   *  - a partial unique index is the final backstop against duplicate active
   *    bookings for the same member + schedule.
   * Lock order is always schedule → member to avoid deadlocks.
   *
   * Soft launch: when both "now" and the class start fall inside the configured
   * window, the class is exclusive to allocated participants (403 otherwise) and
   * a participant is charged nothing. Outside the window the flow below is
   * unchanged from the pre-soft-launch behaviour.
   */
  async createForMember(userId: string, dto: CreateBookingDto): Promise<Booking> {
    const bookingId = await this.dataSource.transaction(async (manager) => {
      // 1. ensure member
      const member = await this.membersService.ensureForUser(manager, userId);
      if (member.status !== MemberStatus.ACTIVE) {
        throw new ForbiddenException('Member account is not active');
      }

      // 2. lock schedule row
      const schedule = await manager.findOne(Schedule, {
        where: { id: dto.schedule_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!schedule) throw new NotFoundException(`Schedule ${dto.schedule_id} not found`);

      // 3. validate schedule is published and bookable
      this.assertBookable(schedule);

      // 3b. soft-launch gate: true → bypass (charge nothing); false → normal rules;
      //     throws 403 SOFT_LAUNCH_NOT_ELIGIBLE for non-participants on in-window classes.
      const softLaunchBypass = await this.softLaunchService.checkBooking(
        manager,
        userId,
        schedule.start_time,
      );

      const classType = await manager.findOne(ClassType, {
        where: { id: schedule.class_type_id },
      });
      const cost = softLaunchBypass ? 0 : (classType?.credit_cost ?? 0);

      // 4. lock member row (re-read under FOR UPDATE)
      const lockedMember = await manager.findOne(Member, {
        where: { id: member.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedMember) throw new NotFoundException('Member not found');

      // 5. check credit balance
      if (cost > 0 && lockedMember.credit_balance < cost) {
        throw new BadRequestException('Insufficient credit balance');
      }

      // 6. check confirmed booking count against capacity
      const confirmedCount = await manager.count(Booking, {
        where: { schedule_id: schedule.id, status: BookingStatus.CONFIRMED },
      });
      if (confirmedCount >= schedule.capacity) {
        throw new ConflictException('Schedule is full');
      }

      // 7. insert booking
      const booking = manager.create(Booking, {
        booking_code: this.generateBookingCode(),
        member_id: lockedMember.id,
        schedule_id: schedule.id,
        status: BookingStatus.CONFIRMED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source: softLaunchBypass ? BookingSource.SOFT_LAUNCH : BookingSource.MEMBER,
        credit_cost: cost,
      });

      let saved: Booking;
      try {
        saved = await manager.save(Booking, booking);
      } catch (e) {
        throw this.mapInsertError(e);
      }

      // 8 & 9. debit credit + immutable ledger entry, then link the booking
      if (cost > 0) {
        const ledger = await this.creditsService.applyDelta(manager, lockedMember, -cost, {
          type: CreditLedgerType.BOOKING_DEBIT,
          bookingId: saved.id,
          reason: `Booking ${saved.booking_code}`,
        });
        saved.credit_ledger_id = ledger.id;
        await manager.save(Booking, saved);
      }

      return saved.id;
    });

    return this.findDetail(bookingId);
  }

  // ── Admin booking on behalf of a member ──────────────────────────────────

  /**
   * Books an existing member into a class on their behalf (owner/admin only).
   *
   * Same rules as a member booking themselves: published future class, active
   * member, soft-launch gate, credit debited at the class's cost (nothing during
   * a soft-launch bypass or for a free class), never over capacity. The one
   * difference is a full class: instead of 409 the member joins the back of the
   * waitlist — exactly what the member-side waitlist join would create, so
   * automatic promotion treats the entry like any other.
   *
   * Lock order is the canonical schedule → booking rows (queue) → member.
   */
  async createByAdmin(adminUserId: string, dto: AdminCreateBookingDto): Promise<Booking> {
    const bookingId = await this.dataSource.transaction(async (manager) => {
      // 1. lock schedule row, validate it is published and bookable
      const schedule = await this.waitlistPromotion.lockSchedule(manager, dto.schedule_id);
      this.assertBookable(schedule);

      // 2. capacity decides confirmed vs waitlisted; a waitlist entry goes to the
      //    back of the (renumbered) active queue
      const confirmedCount = await this.waitlistPromotion.countConfirmed(manager, schedule.id);
      const isFull = confirmedCount >= schedule.capacity;
      const queueLength = isFull
        ? await this.waitlistPromotion.normalizePositions(manager, schedule.id)
        : 0;

      // 3. lock member row
      const member = await manager.findOne(Member, {
        where: { id: dto.member_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) throw new NotFoundException(`Member ${dto.member_id} not found`);
      if (member.status !== MemberStatus.ACTIVE) {
        throw new BadRequestException('Member account is not active');
      }

      // 4. one active booking per member + schedule (the partial unique index
      //    is still the backstop on insert)
      const existing = await manager.findOne(Booking, {
        where: {
          member_id: member.id,
          schedule_id: schedule.id,
          status: In(CANCELLABLE_STATUSES),
        },
      });
      if (existing) {
        throw new ConflictException(
          existing.status === BookingStatus.WAITLISTED
            ? 'Member is already on the waitlist for this schedule'
            : 'Member already has an active booking for this schedule',
        );
      }

      // 5. soft-launch gate, evaluated for the MEMBER (not the admin): true →
      //    bypass (charge nothing); throws 403 SOFT_LAUNCH_NOT_ELIGIBLE when the
      //    class is in-window and the member is not a participant.
      const softLaunchBypass = await this.softLaunchService.checkBooking(
        manager,
        member.user_id,
        schedule.start_time,
      );

      const classType = await manager.findOne(ClassType, {
        where: { id: schedule.class_type_id },
      });
      const classCost = classType?.credit_cost ?? 0;

      // 6a. full → waitlist entry; nothing is charged until promotion
      if (isFull) {
        const entry = manager.create(Booking, {
          booking_code: this.generateBookingCode(),
          member_id: member.id,
          schedule_id: schedule.id,
          status: BookingStatus.WAITLISTED,
          attendance_status: AttendanceStatus.NOT_CHECKED_IN,
          source: BookingSource.ADMIN,
          credit_cost: classCost,
          waitlist_position: queueLength + 1,
        });
        try {
          return (await manager.save(Booking, entry)).id;
        } catch (e) {
          throw this.mapAdminInsertError(e);
        }
      }

      // 6b. seat available → confirmed booking, credit debited in the same transaction
      const cost = softLaunchBypass ? 0 : classCost;
      if (cost > 0 && member.credit_balance < cost) {
        throw new BadRequestException('Member has insufficient credit balance');
      }

      const booking = manager.create(Booking, {
        booking_code: this.generateBookingCode(),
        member_id: member.id,
        schedule_id: schedule.id,
        status: BookingStatus.CONFIRMED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        // A soft-launch bypass keeps its own source so participant booking
        // counts stay correct, same as member bookings and promotions.
        source: softLaunchBypass ? BookingSource.SOFT_LAUNCH : BookingSource.ADMIN,
        credit_cost: cost,
      });

      let saved: Booking;
      try {
        saved = await manager.save(Booking, booking);
      } catch (e) {
        throw this.mapAdminInsertError(e);
      }

      if (cost > 0) {
        const ledger = await this.creditsService.applyDelta(manager, member, -cost, {
          type: CreditLedgerType.BOOKING_DEBIT,
          bookingId: saved.id,
          reason: `Booking ${saved.booking_code} (added by admin)`,
        });
        saved.credit_ledger_id = ledger.id;
        await manager.save(Booking, saved);
      }

      return saved.id;
    });

    const created = await this.findDetail(bookingId);
    // No audit-log table yet — keep a trace of who added the member.
    this.logger.log(
      `Admin ${adminUserId} added member ${created.member_id} to schedule ${created.schedule_id}: ` +
        `${created.booking_code} (${created.status})`,
    );
    return created;
  }

  // ── Cancellation ──────────────────────────────────────────────────────────

  cancelOwn(userId: string, bookingId: string, reason?: string): Promise<Booking> {
    return this.cancelInternal(bookingId, reason, {
      actorUserId: userId,
      requireOwnership: true,
    });
  }

  cancelAny(bookingId: string, adminUserId: string, reason?: string): Promise<Booking> {
    return this.cancelInternal(bookingId, reason, {
      actorUserId: adminUserId,
      requireOwnership: false,
    });
  }

  /**
   * Cancels a booking in one transaction. Refunds credit only when the request
   * is inside the cancellation window; late cancellations forfeit the credit.
   * Existing ledger rows are never mutated — a refund adds a new positive row.
   *
   * A cancelled CONFIRMED booking frees a seat, which is filled from the
   * waitlist in the same transaction (ineligible candidates are skipped, never
   * rolling back this cancellation). A cancelled WAITLISTED entry leaves the
   * queue and the remaining positions are renumbered.
   *
   * Lock order (shared with booking creation and promotion): schedule →
   * booking rows → member rows, so a concurrent cancel/promote of the same
   * entry is serialised instead of deadlocking.
   */
  private async cancelInternal(
    bookingId: string,
    reason: string | undefined,
    opts: { actorUserId: string; requireOwnership: boolean },
  ): Promise<Booking> {
    await this.dataSource.transaction(async (manager) => {
      // Unlocked read: ownership check and which schedule to lock first.
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId },
        relations: ['member'],
      });
      if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`);

      if (opts.requireOwnership && booking.member?.user_id !== opts.actorUserId) {
        throw new ForbiddenException('You can only cancel your own bookings');
      }

      const schedule = await this.waitlistPromotion.lockSchedule(manager, booking.schedule_id);

      // Re-read FOR UPDATE so a concurrent cancel of the same booking is
      // serialised and idempotent.
      const locked = await manager.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException(`Booking ${bookingId} not found`);

      if (!CANCELLABLE_STATUSES.includes(locked.status)) {
        throw new ConflictException(`Booking cannot be cancelled (status: ${locked.status})`);
      }

      const wasConfirmed = locked.status === BookingStatus.CONFIRMED;
      const wasWaitlisted = locked.status === BookingStatus.WAITLISTED;

      // Queue rows are locked only when the queue changes; candidate members only
      // when a seat is freed. Members are always one ascending-id batch.
      const queue =
        wasConfirmed || wasWaitlisted
          ? await this.waitlistPromotion.lockQueue(manager, schedule.id)
          : [];
      const members = await this.waitlistPromotion.lockMembers(manager, [
        locked.member_id,
        ...(wasConfirmed ? queue.map((b) => b.member_id) : []),
      ]);
      const ctx = { schedule, queue, members };
      const member = members.get(locked.member_id);
      if (!member) throw new NotFoundException('Member not found');

      const refundEligible = this.isWithinCancellationWindow(schedule.start_time);

      locked.status = BookingStatus.CANCELLED;
      locked.cancelled_at = new Date();
      locked.waitlist_position = null;
      await manager.save(Booking, locked);

      if (refundEligible && locked.credit_cost > 0 && locked.credit_ledger_id) {
        await this.creditsService.applyDelta(manager, member, locked.credit_cost, {
          type: CreditLedgerType.CANCELLATION_REFUND,
          bookingId: locked.id,
          reason: reason ?? `Refund for cancelled booking ${locked.booking_code}`,
        });
      }

      if (wasConfirmed) {
        await this.waitlistPromotion.fillOpenSeats(manager, ctx);
      } else if (wasWaitlisted) {
        await this.waitlistPromotion.normalizePositions(manager, schedule.id);
      }
    });

    return this.findDetail(bookingId);
  }

  // ── Admin attendance actions ──────────────────────────────────────────────

  async checkIn(bookingId: string): Promise<Booking> {
    const booking = await this.bookingsRepo.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`);
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed bookings can be checked in');
    }
    if (booking.attendance_status !== AttendanceStatus.CHECKED_IN) {
      booking.attendance_status = AttendanceStatus.CHECKED_IN;
      await this.bookingsRepo.save(booking);
    }
    return this.findDetail(bookingId);
  }

  async markNoShow(bookingId: string): Promise<Booking> {
    const booking = await this.bookingsRepo.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`);
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed bookings can be marked as no-show');
    }
    // No refund — a no-show forfeits the credit already debited at booking time.
    booking.status = BookingStatus.NO_SHOW;
    booking.attendance_status = AttendanceStatus.NO_SHOW;
    await this.bookingsRepo.save(booking);
    return this.findDetail(bookingId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private assertBookable(schedule: Schedule): void {
    if (schedule.status !== ScheduleStatus.PUBLISHED || !schedule.is_published) {
      throw new BadRequestException('Schedule is not open for booking');
    }
    if (new Date(schedule.start_time).getTime() <= Date.now()) {
      throw new BadRequestException('Schedule has already started');
    }
  }

  private isWithinCancellationWindow(startTime: Date): boolean {
    const hours =
      this.config.get<number>('BOOKING_CANCELLATION_WINDOW_HOURS') ??
      DEFAULT_CANCELLATION_WINDOW_HOURS;
    const cutoff = new Date(startTime).getTime() - hours * 60 * 60 * 1000;
    return Date.now() <= cutoff;
  }

  private generateBookingCode(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BK-${ts}${rand}`;
  }

  private mapInsertError(e: unknown): Error {
    if (e instanceof QueryFailedError && (e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      const constraint = (e as { constraint?: string }).constraint;
      if (constraint?.includes('active_member_schedule')) {
        return new ConflictException('You already have an active booking for this schedule');
      }
      return new ConflictException('Could not create booking, please retry');
    }
    return e instanceof Error ? e : new Error('Unknown error creating booking');
  }

  /** Same as mapInsertError, worded for an admin acting on a member's behalf. */
  private mapAdminInsertError(e: unknown): Error {
    const mapped = this.mapInsertError(e);
    if (mapped instanceof ConflictException && mapped.message.startsWith('You already have')) {
      return new ConflictException('Member already has an active booking for this schedule');
    }
    return mapped;
  }
}
