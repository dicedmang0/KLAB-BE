import { randomBytes } from 'crypto';
import { Between, EntityManager } from 'typeorm';
import {
  SoftLaunchParticipant,
  SoftLaunchAllocationSource,
} from './entities/soft-launch-participant.entity';

/**
 * Advisory lock key serialising every allocation (registration + admin).
 * ponytail: one global lock — allocations are a few hundred rows per campaign, so
 * throughput is irrelevant; correctness of the count is what matters.
 */
const ALLOCATION_LOCK_KEY = 8020260920;

// 32 symbols, no 0/O/1/I. 256 % 32 === 0 so `byte % 32` is uniform.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
export const CODE_PREFIX = 'KLAB-SL-';
export const CODE_PATTERN = /^KLAB-SL-[A-HJ-NP-Z2-9]{6}$/;

export function generateParticipantCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let body = '';
  for (const b of bytes) body += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return CODE_PREFIX + body;
}

/**
 * The CURRENT soft-launch campaign: [SOFT_LAUNCH_START, SOFT_LAUNCH_END], both
 * inclusive, as parsed instants (offsets honoured, server timezone irrelevant).
 * There is no campaign id: a participant row belongs to the current campaign
 * iff its `allocated_at` lies inside this window. Rows from earlier windows stay
 * stored as history but neither count toward the quota nor grant eligibility.
 */
export interface CampaignWindow {
  start: Date;
  end: Date;
}

/** The one `where` fragment for "allocated in the current campaign" (BETWEEN is inclusive). */
export function inCampaign(window: CampaignWindow) {
  return Between(window.start, window.end);
}

export function isInCampaign(allocatedAt: Date, window: CampaignWindow): boolean {
  const t = new Date(allocatedAt).getTime();
  return t >= window.start.getTime() && t <= window.end.getTime();
}

export interface AllocateOptions {
  userId: string;
  quota: number;
  window: CampaignWindow;
  source: SoftLaunchAllocationSource;
  allocatedBy?: string | null;
}

export type AllocateResult =
  /** Allocated now (created) or already allocated in the current campaign. */
  | { kind: 'allocated'; participant: SoftLaunchParticipant; created: boolean }
  /** The current campaign's quota is used up. */
  | { kind: 'full' }
  /**
   * The user holds a row from an EARLIER campaign. UQ(user_id) allows one row
   * per user ever, so they cannot be re-allocated without a schema change.
   */
  | { kind: 'previous_campaign' };

/**
 * Allocates a current-campaign soft-launch slot for a user.
 * Idempotent: a user already allocated in this campaign gets their row back
 * (created=false).
 *
 * MUST be called inside a transaction (`manager` from dataSource.transaction).
 *
 * Quota guarantee (current-campaign COUNT <= quota):
 *  1. pg_advisory_xact_lock serialises every caller until commit/rollback.
 *  2. Under READ COMMITTED the COUNT statement's snapshot is taken after the lock
 *     is granted, so it always includes the previous holder's committed insert.
 *  3. Two concurrent callers therefore run strictly one after the other: the
 *     second sees the first's row and is refused at the quota.
 *  4. Backstop: UQ(slot_no) — if any future path skips the lock, the duplicate
 *     slot fails with 23505 instead of silently over-allocating.
 *  5. UQ(user_id) makes a registration/admin race for the same user idempotent.
 *
 * Counting vs numbering: the QUOTA counts only rows allocated inside the current
 * window; `slot_no` stays globally unique across all campaigns (UQ(slot_no)), so
 * the next slot is MAX(slot_no) over the WHOLE table + 1 — e.g. after 80 earlier
 * rows the first participant of a new campaign gets slot 81 (campaign count 1).
 */
export async function allocateParticipant(
  manager: EntityManager,
  opts: AllocateOptions,
): Promise<AllocateResult> {
  await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [ALLOCATION_LOCK_KEY]);

  const repo = manager.getRepository(SoftLaunchParticipant);

  const existing = await repo.findOne({ where: { user_id: opts.userId } });
  if (existing) {
    return isInCampaign(existing.allocated_at, opts.window)
      ? { kind: 'allocated', participant: existing, created: false }
      : { kind: 'previous_campaign' };
  }

  const allocated = await repo.count({ where: { allocated_at: inCampaign(opts.window) } });
  if (allocated >= opts.quota) return { kind: 'full' };

  // Global next slot (all campaigns): MAX + 1, never COUNT + 1, so neither earlier
  // campaigns nor a manually deleted row can make it collide on UQ(slot_no).
  const { max } = await repo
    .createQueryBuilder('p')
    .select('COALESCE(MAX(p.slot_no), 0)', 'max')
    .getRawOne<{ max: number | string }>();

  // Collision pre-check against ALL rows (UQ(code) is global); race-free because
  // every allocator holds the lock. The UNIQUE constraint remains the guarantee.
  let code = generateParticipantCode();
  while (await repo.exists({ where: { code } })) code = generateParticipantCode();

  const participant = repo.create({
    user_id: opts.userId,
    code,
    slot_no: Number(max) + 1,
    source: opts.source,
    allocated_by: opts.allocatedBy ?? null,
  });
  return { kind: 'allocated', participant: await repo.save(participant), created: true };
}
