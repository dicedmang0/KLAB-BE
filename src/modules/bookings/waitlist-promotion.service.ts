import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { Booking, BookingSource, BookingStatus } from './entities/booking.entity';
import { Schedule, ScheduleStatus } from '../schedules/entities/schedule.entity';
import { Member, MemberStatus } from '../members/entities/member.entity';
import { CreditLedgerType } from '../credits/entities/credit-ledger.entity';
import { CreditsService } from '../credits/credits.service';
import { SoftLaunchService, SOFT_LAUNCH_NOT_ELIGIBLE } from '../soft-launch/soft-launch.service';

export const WAITLIST_QUEUE_PRIORITY = 'WAITLIST_QUEUE_PRIORITY';

/** Why a waitlisted member cannot be promoted right now. Never permanent. */
export type SkipReason = 'inactive_member' | 'insufficient_credit' | 'soft_launch_ineligible';

/** `ok` → `cost`/`softLaunch` apply; otherwise `reason` + the error to surface. */
interface Eligibility {
  ok: boolean;
  cost?: number;
  softLaunch?: boolean;
  reason?: SkipReason;
  error?: Error;
}

/** The locked rows a promotion run works on. */
export interface LockedQueue {
  schedule: Schedule;
  /** Active waitlist rows, locked, in queue order. */
  queue: Booking[];
  /** Locked members keyed by id (queue members plus any extra ids requested). */
  members: Map<string, Member>;
}

/**
 * Single source of truth for waitlist promotion, used by automatic fill after a
 * confirmed cancellation and by the admin manual-promote endpoint.
 *
 * Canonical lock order for every booking/waitlist mutation on a schedule:
 *   1. schedule row            (serialises all capacity decisions per class)
 *   2. booking rows            (the target booking and/or the active queue)
 *   3. member rows             (one batch, ascending id)
 * Members are always locked in a single ascending-id batch, so two transactions
 * on different schedules that share members can never lock them in opposite
 * order. Every other code path locks at most one member row.
 */
@Injectable()
export class WaitlistPromotionService {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly softLaunchService: SoftLaunchService,
  ) {}

  // ── Locking ────────────────────────────────────────────────────────────────

  async lockSchedule(manager: EntityManager, scheduleId: string): Promise<Schedule> {
    const schedule = await manager.findOne(Schedule, {
      where: { id: scheduleId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!schedule) throw new NotFoundException(`Schedule ${scheduleId} not found`);
    return schedule;
  }

  /** Active waitlist rows in queue order: position, then join time, then id. */
  lockQueue(manager: EntityManager, scheduleId: string): Promise<Booking[]> {
    return manager.find(Booking, {
      where: { schedule_id: scheduleId, status: BookingStatus.WAITLISTED },
      order: {
        waitlist_position: { direction: 'ASC', nulls: 'LAST' },
        created_at: 'ASC',
        id: 'ASC',
      },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Locks members in one ascending-id batch (see class doc for why). */
  async lockMembers(manager: EntityManager, ids: string[]): Promise<Map<string, Member>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await manager.find(Member, {
      where: { id: In(unique) },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    return new Map(rows.map((m) => [m.id, m]));
  }

  /** Locks the queue and its members (plus `extraMemberIds`) for a locked schedule. */
  async lockQueueAndMembers(
    manager: EntityManager,
    schedule: Schedule,
    extraMemberIds: string[] = [],
  ): Promise<LockedQueue> {
    const queue = await this.lockQueue(manager, schedule.id);
    const members = await this.lockMembers(manager, [
      ...extraMemberIds,
      ...queue.map((b) => b.member_id),
    ]);
    return { schedule, queue, members };
  }

  // ── Schedule rules ─────────────────────────────────────────────────────────

  /** Same rule as booking/waitlist join: published and not yet started. */
  isPromotable(schedule: Schedule): boolean {
    return (
      schedule.status === ScheduleStatus.PUBLISHED &&
      schedule.is_published &&
      new Date(schedule.start_time).getTime() > Date.now()
    );
  }

  assertPromotable(schedule: Schedule): void {
    if (schedule.status !== ScheduleStatus.PUBLISHED || !schedule.is_published) {
      throw new BadRequestException('Schedule is not open for booking');
    }
    if (new Date(schedule.start_time).getTime() <= Date.now()) {
      throw new BadRequestException('Schedule has already started');
    }
  }

  countConfirmed(manager: EntityManager, scheduleId: string): Promise<number> {
    return manager.count(Booking, {
      where: { schedule_id: scheduleId, status: BookingStatus.CONFIRMED },
    });
  }

  // ── Eligibility + mutation ─────────────────────────────────────────────────

  /**
   * Whether `entry` can be confirmed right now. Expected business failures are
   * returned as a skip; anything unexpected is rethrown untouched.
   */
  async evaluate(
    manager: EntityManager,
    schedule: Schedule,
    entry: Booking,
    member: Member | undefined,
  ): Promise<Eligibility> {
    if (!member) throw new NotFoundException('Member not found');

    if (member.status !== MemberStatus.ACTIVE) {
      return {
        ok: false,
        reason: 'inactive_member',
        error: new BadRequestException('Member account is not active'),
      };
    }

    let softLaunch: boolean;
    try {
      softLaunch = await this.softLaunchService.checkBooking(
        manager,
        member.user_id,
        schedule.start_time,
      );
    } catch (e) {
      if (e instanceof ForbiddenException && responseCode(e) === SOFT_LAUNCH_NOT_ELIGIBLE) {
        return { ok: false, reason: 'soft_launch_ineligible', error: e };
      }
      throw e;
    }

    const cost = softLaunch ? 0 : entry.credit_cost;
    if (cost > 0 && member.credit_balance < cost) {
      return {
        ok: false,
        reason: 'insufficient_credit',
        error: new BadRequestException('Member has insufficient credit balance to be promoted'),
      };
    }
    return { ok: true, cost, softLaunch };
  }

  /** Confirms an eligible entry: leaves the queue, debits credit once if due. */
  private async confirm(
    manager: EntityManager,
    entry: Booking,
    member: Member,
    eligibility: Eligibility,
  ): Promise<void> {
    entry.status = BookingStatus.CONFIRMED;
    entry.waitlist_position = null;
    if (eligibility.softLaunch) {
      entry.credit_cost = 0;
      entry.source = BookingSource.SOFT_LAUNCH;
    }
    await manager.save(Booking, entry);

    if (eligibility.cost > 0) {
      const ledger = await this.creditsService.applyDelta(manager, member, -eligibility.cost, {
        type: CreditLedgerType.BOOKING_DEBIT,
        bookingId: entry.id,
        reason: `Waitlist promotion ${entry.booking_code}`,
      });
      entry.credit_ledger_id = ledger.id;
      await manager.save(Booking, entry);
    }
  }

  // ── Promotion flows ────────────────────────────────────────────────────────

  /**
   * Fills open seats from the front of the queue, skipping members who are
   * ineligible right now (they stay waitlisted for a later run). Stops when the
   * class is full or the queue is exhausted. No-op for classes that are not
   * open for booking (started, cancelled, unpublished). Returns promoted ids.
   */
  async fillOpenSeats(manager: EntityManager, locked: LockedQueue): Promise<string[]> {
    const { schedule, queue, members } = locked;
    if (!this.isPromotable(schedule)) return [];

    let free = schedule.capacity - (await this.countConfirmed(manager, schedule.id));
    const promoted: string[] = [];

    // Each entry is evaluated at most once per run, so an ineligible #1 never loops.
    for (const entry of queue) {
      if (free <= 0) break;
      const member = members.get(entry.member_id);
      const eligibility = await this.evaluate(manager, schedule, entry, member);
      if (!eligibility.ok) continue;
      await this.confirm(manager, entry, member!, eligibility);
      promoted.push(entry.id);
      free--;
    }

    // Also heals gaps left by data written before positions were normalised.
    if (queue.length > 0) await this.normalizePositions(manager, schedule.id);
    return promoted;
  }

  /**
   * Admin promotion of one entry. Allowed only when it is the first entry in
   * queue order that is eligible right now; earlier ineligible members may be
   * passed over, earlier eligible members may not.
   */
  async promoteSpecific(
    manager: EntityManager,
    locked: LockedQueue,
    entryId: string,
  ): Promise<void> {
    const { schedule, queue, members } = locked;
    this.assertPromotable(schedule);

    const target = queue.find((b) => b.id === entryId);
    if (!target) {
      const current = await manager.findOne(Booking, { where: { id: entryId } });
      if (!current) throw new NotFoundException(`Waitlist entry ${entryId} not found`);
      throw new ConflictException(`Booking is not on the waitlist (status: ${current.status})`);
    }

    const confirmed = await this.countConfirmed(manager, schedule.id);
    if (confirmed >= schedule.capacity) throw new ConflictException('Schedule is full');

    for (const entry of queue) {
      const member = members.get(entry.member_id);
      const eligibility = await this.evaluate(manager, schedule, entry, member);
      if (entry.id === target.id) {
        if (!eligibility.ok) throw eligibility.error;
        await this.confirm(manager, entry, member!, eligibility);
        break;
      }
      if (eligibility.ok) {
        throw new ConflictException({
          message: 'Another eligible member is ahead in the waitlist.',
          code: WAITLIST_QUEUE_PRIORITY,
        });
      }
    }

    await this.normalizePositions(manager, schedule.id);
  }

  /**
   * Renumbers the active queue to 1..n in queue order. Callers hold the schedule
   * lock, so this cannot race with another queue mutation for the class.
   */
  async normalizePositions(manager: EntityManager, scheduleId: string): Promise<number> {
    const queue = await this.lockQueue(manager, scheduleId);
    for (const [i, entry] of queue.entries()) {
      if (entry.waitlist_position !== i + 1) {
        entry.waitlist_position = i + 1;
        await manager.save(Booking, entry);
      }
    }
    return queue.length;
  }
}

function responseCode(e: ForbiddenException): string | undefined {
  const res = e.getResponse();
  return typeof res === 'object' && res !== null ? (res as { code?: string }).code : undefined;
}
