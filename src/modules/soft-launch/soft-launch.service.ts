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
import { allocateParticipant, AllocateResult } from './soft-launch.allocator';
import { AllocateParticipantDto } from './dto/allocate-participant.dto';
import { User } from '../users/entities/user.entity';
import { Member, MemberStatus } from '../members/entities/member.entity';
import { Booking, BookingSource } from '../bookings/entities/booking.entity';

export const SOFT_LAUNCH_NOT_ELIGIBLE = 'SOFT_LAUNCH_NOT_ELIGIBLE';
export const SOFT_LAUNCH_QUOTA_FULL = 'SOFT_LAUNCH_QUOTA_FULL';
export const SOFT_LAUNCH_ALLOCATION_CLOSED = 'SOFT_LAUNCH_ALLOCATION_CLOSED';

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

  /** Auto/admin allocation is open from deploy (enabled) until the window ends. */
  allocationOpen(): boolean {
    const { enabled, end } = this.cfg;
    return enabled && !!end && Date.now() <= end.getTime();
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
   * no allocation — in-window classes are exclusive to participants, with no
   * fallback to credit booking.
   *
   * Eligibility is resolved from the authenticated user id only; a participant
   * code is never accepted as input.
   */
  async checkBooking(
    manager: EntityManager,
    userId: string | null | undefined,
    scheduleStart: Date,
  ): Promise<boolean> {
    if (!this.windowActive(new Date()) || !this.windowActive(scheduleStart)) return false;

    const participant = userId
      ? await manager.findOne(SoftLaunchParticipant, { where: { user_id: userId } })
      : null;
    if (!participant) {
      throw new ForbiddenException({
        message: 'This class is reserved for soft-launch participants',
        code: SOFT_LAUNCH_NOT_ELIGIBLE,
      });
    }
    return true;
  }

  // ── Allocation ────────────────────────────────────────────────────────────

  findByUserId(userId: string): Promise<SoftLaunchParticipant | null> {
    return this.dataSource
      .getRepository(SoftLaunchParticipant)
      .findOne({ where: { user_id: userId } });
  }

  /** Transactional, idempotent allocation. Null when the quota is full. */
  allocate(
    userId: string,
    source: SoftLaunchAllocationSource,
    allocatedBy: string | null = null,
  ): Promise<AllocateResult | null> {
    return this.dataSource.transaction((manager) =>
      allocateParticipant(manager, { userId, quota: this.cfg.quota, source, allocatedBy }),
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
      if (!result) this.logger.log(`quota full — user ${userId} registered without a slot`);
    } catch (e) {
      this.logger.error(
        `allocation failed for user ${userId}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  // ── Member-facing view ────────────────────────────────────────────────────

  async viewFor(userId: string): Promise<SoftLaunchView> {
    const { enabled, quota } = this.cfg;
    const repo = this.dataSource.getRepository(SoftLaunchParticipant);
    const participant = await repo.findOne({ where: { user_id: userId } });
    const eligible = !!participant;
    const quotaFull = !eligible && enabled ? (await repo.count()) >= quota : false;

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
      throw new ConflictException({
        message: this.cfg.enabled
          ? 'Soft-launch allocation period has ended'
          : 'Soft launch is not enabled',
        code: SOFT_LAUNCH_ALLOCATION_CLOSED,
      });
    }

    const result = await this.allocate(user.id, SoftLaunchAllocationSource.ADMIN, adminUserId);
    if (!result) {
      throw new ConflictException({
        message: 'Soft-launch quota is full',
        code: SOFT_LAUNCH_QUOTA_FULL,
      });
    }

    const [view] = await this.queryAdminViews(user.id);
    return view;
  }

  async listForAdmin(): Promise<AdminParticipantList> {
    const { enabled, start, end, quota } = this.cfg;
    const items = await this.queryAdminViews();
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

    if (userId) qb.where('p.user_id = :userId', { userId });

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
