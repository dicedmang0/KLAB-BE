import { randomBytes } from 'crypto';
import { EntityManager } from 'typeorm';
import {
  SoftLaunchParticipant,
  SoftLaunchAllocationSource,
} from './entities/soft-launch-participant.entity';

/**
 * Advisory lock key serialising every allocation (registration + admin).
 * ponytail: one global lock — the table holds at most `quota` (80) rows ever, so
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

export interface AllocateOptions {
  userId: string;
  quota: number;
  source: SoftLaunchAllocationSource;
  allocatedBy?: string | null;
}

export interface AllocateResult {
  participant: SoftLaunchParticipant;
  created: boolean;
}

/**
 * Allocates a soft-launch slot for a user, or returns null when the quota is full.
 * Idempotent: an already-allocated user gets their existing row back (created=false).
 *
 * MUST be called inside a transaction (`manager` from dataSource.transaction).
 *
 * Quota guarantee (COUNT(*) <= quota):
 *  1. pg_advisory_xact_lock serialises every caller until commit/rollback.
 *  2. Under READ COMMITTED the COUNT statement's snapshot is taken after the lock
 *     is granted, so it always includes the previous holder's committed insert.
 *  3. Two concurrent callers therefore run strictly one after the other: the
 *     second sees the first's row and is refused at the quota.
 *  4. Backstop: UQ(slot_no) — if any future path skips the lock, the duplicate
 *     slot fails with 23505 instead of silently becoming participant quota+1.
 *  5. UQ(user_id) makes a registration/admin race for the same user idempotent.
 * Rows are never deleted in production, so COUNT(*) == MAX(slot_no); the slot is
 * still taken as MAX + 1 so an out-of-band deletion can never break allocation.
 */
export async function allocateParticipant(
  manager: EntityManager,
  opts: AllocateOptions,
): Promise<AllocateResult | null> {
  await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [ALLOCATION_LOCK_KEY]);

  const repo = manager.getRepository(SoftLaunchParticipant);

  const existing = await repo.findOne({ where: { user_id: opts.userId } });
  if (existing) return { participant: existing, created: false };

  const allocated = await repo.count();
  if (allocated >= opts.quota) return null;

  // Next slot = MAX + 1 (not COUNT + 1) so a manually deleted row can never make
  // a later allocation collide on UQ(slot_no); the quota itself is COUNT-based.
  const { max } = await repo
    .createQueryBuilder('p')
    .select('COALESCE(MAX(p.slot_no), 0)', 'max')
    .getRawOne<{ max: number | string }>();

  // Collision pre-check is race-free here because every allocator holds the lock;
  // the UNIQUE constraint remains the hard guarantee.
  let code = generateParticipantCode();
  while (await repo.exists({ where: { code } })) code = generateParticipantCode();

  const participant = repo.create({
    user_id: opts.userId,
    code,
    slot_no: Number(max) + 1,
    source: opts.source,
    allocated_by: opts.allocatedBy ?? null,
  });
  return { participant: await repo.save(participant), created: true };
}
