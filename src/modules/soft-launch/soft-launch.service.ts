import {
  Injectable,
  Logger,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { SoftLaunchConfig } from '../../config/soft-launch.config';
import {
  SoftLaunchParticipant,
  SoftLaunchAllocationSource,
} from './entities/soft-launch-participant.entity';
import {
  allocateParticipant,
  AllocateResult,
  CampaignWindow,
  inCampaign,
} from './soft-launch.allocator';
import { AllocateParticipantDto } from './dto/allocate-participant.dto';
import { User } from '../users/entities/user.entity';
import { Member, MemberStatus } from '../members/entities/member.entity';
import { Booking, BookingSource } from '../bookings/entities/booking.entity';

export const SOFT_LAUNCH_NOT_ELIGIBLE = 'SOFT_LAUNCH_NOT_ELIGIBLE';
export const SOFT_LAUNCH_QUOTA_FULL = 'SOFT_LAUNCH_QUOTA_FULL';
export const SOFT_LAUNCH_ALLOCATION_CLOSED = 'SOFT_LAUNCH_ALLOCATION_CLOSED';
/** The user was a participant in an earlier campaign; UQ(user_id) blocks a second row. */
export const SOFT_LAUNCH_PREVIOUS_CAMPAIGN = 'SOFT_LAUNCH_PREVIOUS_CAMPAIGN';

/** Safe, owner-only projection returned inside authenticated responses. */
export interface SoftLaunchView {
  enabled: boolean;
  active: boolean;
  eligible: boolean;
  participant_code: string | null;
  allocated_at: Date | null;
  quota_full: boolean;
}

export type ParticipantStatus = 'disabled' | 'pending' | 'active' | 'expired';

export interface AdminParticipantView {
  id: string;
  code: string;
  slot_no: number;
  source: string;
  status: ParticipantStatus;
  allocated_by: string | null;
  allocated_at: Date;
  user: { id: string; email: string; full_name: string } | null;
  member: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    status: MemberStatus;
  } | null;
  soft_launch_bookings: number;
}

export interface AdminParticipantList {
  summary: {
    enabled: boolean;
    active: boolean;
    start: Date | null;
    end: Date | null;
    quota: number;
    allocated: number;
    remaining: number;
  };
  items: AdminParticipantView[];
}

@Injectable()
export class SoftLaunchService {
  private readonly logger = new Logger(SoftLaunchService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  // ── Window ────────────────────────────────────────────────────────────────

  private get cfg(): SoftLaunchConfig {
    return this.config.get<SoftLaunchConfig>('softLaunch');
  }

  /** True iff the feature is enabled and `at` lies inside [start, end] (end inclusive). */
  windowActive(at: Date): boolean {
    const { enabled, start, end } = this.cfg;
    if (!enabled || !start || !end) return false;
    const t = new Date(at).getTime();
    return t >= start.getTime() && t <= end.getTime();
  }

  /**
   * The current campaign window [SOFT_LAUNCH_START, SOFT_LAUNCH_END] (inclusive),
   * or null when not configured. Defines BOTH the booking window and which
   * participant rows belong to the current campaign (allocated_at inside it).
   */
  campaignWindow(): CampaignWindow | null {
    const { start, end } = this.cfg;
    return start && end ? { start, end } : null;
  }

  /**
   * Allocation (registration + admin) is open only while the window is active:
   * START <= now <= END. A row allocated before START would fall outside the
   * campaign window (not counted, not eligible) and UQ(user_id) would block that
   * user for good, so allocation can no longer open early.
   */
  allocationOpen(): boolean {
    return this.windowActive(new Date());
  }

  /**
   * The user's participant row for the CURRENT campaign, or null. A row from an
   * earlier window is history: it is never returned here, so it grants nothing.
   */
  private currentParticipant(
    manager: EntityManager,
    userId: string,
  ): Promise<SoftLaunchParticipant | null> {
    const window = this.campaignWindow();
    if (!window) return Promise.resolve(null);
    return manager.findOne(SoftLaunchParticipant, {
      where: { user_id: userId, allocated_at: inCampaign(window) },
    });
  }

  /** Participants allocated in the CURRENT campaign (earlier windows excluded). */
  private async currentAllocatedCount(manager: EntityManager): Promise<number> {
    const window = this.campaignWindow();
    if (!window) return 0;
    return manager.count(SoftLaunchParticipant, { where: { allocated_at: inCampaign(window) } });
  }

  // ── Booking gate ──────────────────────────────────────────────────────────

  /**
   * Soft-launch gate for creating a booking / joining a waitlist / promoting.
   *
   * Returns `true` when the soft-launch bypass applies (submission now AND the
   * class start both inside the window, and the user holds an allocation):
   * the caller must then charge nothing.
   * Returns `false` when soft-launch rules do not apply (feature off, now outside
   * the window, or class outside the window): the caller runs the unchanged
   * normal credit flow.
   * Throws 403 SOFT_LAUNCH_NOT_ELIGIBLE when the rules apply but the user holds
   * no CURRENT-campaign allocation (none at all, or only one from an earlier
   * window) — in-window classes are exclusive to current participants, with no
   * fallback to credit booking.
   *
   * Eligibility is resolved from the authenticated user id only; a participant
   * code is never accepted as input. Used by direct booking, waitlist join and
   * waitlist promotion alike.
   */
  async checkBooking(
    manager: EntityManager,
    userId: string | null | undefined,
    scheduleStart: Date,
  ): Promise<boolean> {
    if (!this.windowActive(new Date()) || !this.windowActive(scheduleStart)) return false;

    const participant = userId ? await this.currentParticipant(manager, userId) : null;
    if (!participant) {
      throw new ForbiddenException({
        message: 'This class is reserved for soft-launch participants',
        code: SOFT_LAUNCH_NOT_ELIGIBLE,
      });
    }
    return true;
  }

  // ── Allocation ────────────────────────────────────────────────────────────

  /** The user's CURRENT-campaign participant row, or null. */
  findByUserId(userId: string): Promise<SoftLaunchParticipant | null> {
    return this.currentParticipant(this.dataSource.manager, userId);
  }

  /**
   * Transactional, idempotent current-campaign allocation. Callers check
   * allocationOpen() first, so a configured window always exists here.
   */
  allocate(
    userId: string,
    source: SoftLaunchAllocationSource,
    allocatedBy: string | null = null,
  ): Promise<AllocateResult> {
    const window = this.campaignWindow();
    if (!window) return Promise.resolve({ kind: 'full' });
    return this.dataSource.transaction((manager) =>
      allocateParticipant(manager, {
        userId,
        quota: this.cfg.quota,
        window,
        source,
        allocatedBy,
      }),
    );
  }

  /**
   * Best-effort allocation right after registration. Never throws: registration
   * must succeed whether the quota is full, the period is closed, or the
   * allocation itself fails (an admin can backfill via POST /admin/soft-launch/participants).
   */
  async tryAllocateOnRegistration(userId: string): Promise<void> {
    if (!this.allocationOpen()) return;
    try {
      const result = await this.allocate(userId, SoftLaunchAllocationSource.REGISTRATION);
      if (result.kind === 'full') {
        this.logger.log(`quota full — user ${userId} registered without a slot`);
      } else if (result.kind === 'previous_campaign') {
        this.logger.log(`user ${userId} holds a previous-campaign slot — not re-allocated`);
      }
    } catch (e) {
      this.logger.error(
        `allocation failed for user ${userId}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  // ── Member-facing view ────────────────────────────────────────────────────

  /**
   * Current-campaign view: `eligible`, `participant_code` and `allocated_at`
   * reflect only an allocation inside the current window (an earlier-campaign
   * row reads as not eligible), and `quota_full` compares the current-campaign
   * count with SOFT_LAUNCH_QUOTA — earlier campaigns never fill it.
   */
  async viewFor(userId: string): Promise<SoftLaunchView> {
    const { enabled, quota } = this.cfg;
    const manager = this.dataSource.manager;
    const participant = await this.currentParticipant(manager, userId);
    const eligible = !!participant;
    const quotaFull =
      !eligible && enabled ? (await this.currentAllocatedCount(manager)) >= quota : false;

    return {
      enabled,
      active: this.windowActive(new Date()),
      eligible,
      participant_code: participant?.code ?? null,
      allocated_at: participant?.allocated_at ?? null,
      quota_full: quotaFull,
    };
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  async allocateByAdmin(
    dto: AllocateParticipantDto,
    adminUserId: string,
  ): Promise<AdminParticipantView> {
    const usersRepo = this.dataSource.getRepository(User);
    const user = dto.user_id
      ? await usersRepo.findOne({ where: { id: dto.user_id } })
      : await usersRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new NotFoundException('User not found');

    if (!this.allocationOpen()) {
      const { enabled, start } = this.cfg;
      throw new ConflictException({
        message: !enabled
          ? 'Soft launch is not enabled'
          : start && Date.now() < start.getTime()
            ? 'Soft-launch allocation has not opened yet'
            : 'Soft-launch allocation period has ended',
        code: SOFT_LAUNCH_ALLOCATION_CLOSED,
      });
    }

    const result = await this.allocate(user.id, SoftLaunchAllocationSource.ADMIN, adminUserId);
    if (result.kind === 'full') {
      throw new ConflictException({
        message: 'Soft-launch quota is full',
        code: SOFT_LAUNCH_QUOTA_FULL,
      });
    }
    if (result.kind === 'previous_campaign') {
      throw new ConflictException({
        message:
          'This user was a participant in a previous soft-launch campaign and cannot be allocated again.',
        code: SOFT_LAUNCH_PREVIOUS_CAMPAIGN,
      });
    }

    const [view] = await this.queryAdminViews(user.id);
    return view;
  }

  /**
   * The CURRENT campaign: only participants allocated inside the configured
   * window are listed and counted (`allocated`, `remaining`). Earlier-campaign
   * rows stay in the table as history but are not part of this view.
   */
  async listForAdmin(): Promise<AdminParticipantList> {
    const { enabled, start, end, quota } = this.cfg;
    const items = this.campaignWindow() ? await this.queryAdminViews() : [];
    return {
      summary: {
        enabled,
        active: this.windowActive(new Date()),
        start,
        end,
        quota,
        allocated: items.length,
        remaining: Math.max(quota - items.length, 0),
      },
      items,
    };
  }

  private participantStatus(): ParticipantStatus {
    const { enabled, start, end } = this.cfg;
    if (!enabled || !start || !end) return 'disabled';
    const now = Date.now();
    if (now < start.getTime()) return 'pending';
    if (now > end.getTime()) return 'expired';
    return 'active';
  }

  private async queryAdminViews(userId?: string): Promise<AdminParticipantView[]> {
    const qb = this.dataSource
      .createQueryBuilder(SoftLaunchParticipant, 'p')
      .leftJoin(User, 'u', 'u.id = p.user_id')
      .leftJoin(Member, 'm', 'm.user_id = p.user_id')
      .select('p.id', 'id')
      .addSelect('p.code', 'code')
      .addSelect('p.slot_no', 'slot_no')
      .addSelect('p.source', 'source')
      .addSelect('p.allocated_by', 'allocated_by')
      .addSelect('p.allocated_at', 'allocated_at')
      .addSelect('u.id', 'user_id')
      .addSelect('u.email', 'user_email')
      .addSelect('u.full_name', 'user_full_name')
      .addSelect('m.id', 'member_id')
      .addSelect('m.first_name', 'member_first_name')
      .addSelect('m.last_name', 'member_last_name')
      .addSelect('m.status', 'member_status')
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(*)')
            .from(Booking, 'b')
            .where('b.member_id = m.id')
            .andWhere(`b.source = '${BookingSource.SOFT_LAUNCH}'`),
        'soft_launch_bookings',
      )
      .orderBy('p.slot_no', 'ASC');

    // Current campaign only (same inclusive window as inCampaign()).
    const window = this.campaignWindow();
    if (!window) return [];
    qb.where('p.allocated_at BETWEEN :start AND :end', window);
    if (userId) qb.andWhere('p.user_id = :userId', { userId });

    const status = this.participantStatus();
    const rows = await qb.getRawMany();
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      slot_no: Number(r.slot_no),
      source: r.source,
      status,
      allocated_by: r.allocated_by ?? null,
      allocated_at: r.allocated_at,
      user: r.user_id ? { id: r.user_id, email: r.user_email, full_name: r.user_full_name } : null,
      member: r.member_id
        ? {
            id: r.member_id,
            first_name: r.member_first_name ?? null,
            last_name: r.member_last_name ?? null,
            status: r.member_status,
          }
        : null,
      soft_launch_bookings: Number(r.soft_launch_bookings ?? 0),
    }));
  }
}
