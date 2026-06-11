import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Booking, BookingStatus, AttendanceStatus, BookingSource } from './entities/booking.entity';
import { Schedule, ScheduleStatus } from '../schedules/entities/schedule.entity';
import { ClassType } from '../class-types/entities/class-type.entity';
import { Member, MemberStatus } from '../members/entities/member.entity';
import { CreditLedgerType } from '../credits/entities/credit-ledger.entity';
import { CreditsService } from '../credits/credits.service';
import { MembersService } from '../members/members.service';
import { CreateBookingDto } from './dto/create-booking.dto';
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
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,
    private readonly creditsService: CreditsService,
    private readonly membersService: MembersService,
    private readonly config: ConfigService,
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

      const classType = await manager.findOne(ClassType, {
        where: { id: schedule.class_type_id },
      });
      const cost = classType?.credit_cost ?? 0;

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
        source: BookingSource.MEMBER,
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
   */
  private async cancelInternal(
    bookingId: string,
    reason: string | undefined,
    opts: { actorUserId: string; requireOwnership: boolean },
  ): Promise<Booking> {
    await this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId },
        relations: ['member', 'schedule'],
      });
      if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`);

      if (opts.requireOwnership && booking.member?.user_id !== opts.actorUserId) {
        throw new ForbiddenException('You can only cancel your own bookings');
      }

      // Lock member (for the refund) then re-read the booking FOR UPDATE so a
      // concurrent cancel of the same booking is serialised and idempotent.
      const member = await manager.findOne(Member, {
        where: { id: booking.member_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) throw new NotFoundException('Member not found');

      const locked = await manager.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException(`Booking ${bookingId} not found`);

      if (!CANCELLABLE_STATUSES.includes(locked.status)) {
        throw new ConflictException(`Booking cannot be cancelled (status: ${locked.status})`);
      }

      const refundEligible = this.isWithinCancellationWindow(booking.schedule.start_time);

      locked.status = BookingStatus.CANCELLED;
      locked.cancelled_at = new Date();
      await manager.save(Booking, locked);

      if (refundEligible && locked.credit_cost > 0 && locked.credit_ledger_id) {
        await this.creditsService.applyDelta(manager, member, locked.credit_cost, {
          type: CreditLedgerType.CANCELLATION_REFUND,
          bookingId: locked.id,
          reason: reason ?? `Refund for cancelled booking ${locked.booking_code}`,
        });
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
}
