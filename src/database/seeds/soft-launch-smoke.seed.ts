import * as bcrypt from 'bcrypt';
import { DataSource, In } from 'typeorm';
import { User, UserStatus } from '../../modules/users/entities/user.entity';
import { Role } from '../../modules/roles/entities/role.entity';
import {
  SoftLaunchParticipant,
  SoftLaunchAllocationSource,
} from '../../modules/soft-launch/entities/soft-launch-participant.entity';
import { allocateParticipant, CODE_PATTERN } from '../../modules/soft-launch/soft-launch.allocator';

/**
 * LOCAL/DEV-ONLY soft-launch quota concurrency check.
 *
 * Fires CONCURRENT_USERS (default 100) allocations at the same time against a
 * real PostgreSQL and asserts that the quota (SOFT_LAUNCH_QUOTA, default 80)
 * is never exceeded, slots are contiguous (on a clean table), and codes are
 * unique + well-formed. This is the one runnable check that fails if the
 * advisory-lock allocator ever lets participant #81 through.
 *
 * Idempotency: QA users (qa.softlaunch.NNN@klab.test) are upserted and their
 * own participant rows are removed before and after the run, so local quota is
 * never consumed by fixtures. Rows of any other user are left untouched and
 * count toward the quota: expected total = min(existingOthers + CONCURRENT_USERS, quota).
 *
 * Safety: refuses to run when APP_ENV/NODE_ENV is production or staging.
 */

const QA_PASSWORD = 'KlabSmokeTest123!';
const BCRYPT_ROUNDS = 12;
const CONCURRENT_USERS = parseInt(process.env.SOFT_LAUNCH_SMOKE_USERS ?? '100', 10);

function assertDevEnvironment(): void {
  const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? '').toLowerCase();
  if (env === 'production' || env === 'staging') {
    throw new Error(
      `[soft-launch-smoke] refusing to run: APP_ENV/NODE_ENV is "${env}". This seed is local/dev-only.`,
    );
  }
}

function qaEmail(i: number): string {
  return `qa.softlaunch.${String(i).padStart(3, '0')}@klab.test`;
}

export async function seedSoftLaunchSmoke(dataSource: DataSource): Promise<void> {
  assertDevEnvironment();

  const quota = parseInt(process.env.SOFT_LAUNCH_QUOTA ?? '80', 10);
  const userRepo = dataSource.getRepository(User);
  const participantRepo = dataSource.getRepository(SoftLaunchParticipant);

  const memberRole = await dataSource.getRepository(Role).findOne({ where: { name: 'member' } });
  if (!memberRole)
    throw new Error('[soft-launch-smoke] "member" role not found. Run: npm run seed first.');

  // ── Fixture users (upsert by email) ────────────────────────────────────────
  console.log(`[soft-launch-smoke] Preparing ${CONCURRENT_USERS} QA users...`);
  const passwordHash = await bcrypt.hash(QA_PASSWORD, BCRYPT_ROUNDS);
  const emails = Array.from({ length: CONCURRENT_USERS }, (_, i) => qaEmail(i + 1));

  await userRepo.upsert(
    emails.map((email) => ({
      email,
      password_hash: passwordHash,
      full_name: `QA Soft Launch ${email.split('@')[0].split('.').pop()}`,
      role_id: memberRole.id,
      status: UserStatus.ACTIVE,
    })),
    { conflictPaths: ['email'], skipUpdateIfNoValuesChanged: true },
  );
  const users = await userRepo.find({ where: { email: In(emails) } });
  const qaUserIds = users.map((u) => u.id);

  // Reset only the QA users' own allocations so the run is repeatable.
  await participantRepo.delete({ user_id: In(qaUserIds) });
  const existingOthers = await participantRepo.count();
  const expectedTotal = Math.min(existingOthers + CONCURRENT_USERS, quota);

  // ── Concurrent allocation ─────────────────────────────────────────────────
  console.log(
    `[soft-launch-smoke] quota=${quota} existingOthers=${existingOthers} firing ${CONCURRENT_USERS} concurrent allocations...`,
  );
  const started = Date.now();
  const results = await Promise.all(
    qaUserIds.map((userId) =>
      dataSource.transaction((manager) =>
        allocateParticipant(manager, {
          userId,
          quota,
          source: SoftLaunchAllocationSource.REGISTRATION,
        }),
      ),
    ),
  );
  const elapsed = Date.now() - started;

  // ── Assertions ────────────────────────────────────────────────────────────
  const granted = results.filter((r) => r?.created).length;
  const refused = results.filter((r) => r === null).length;

  const rows = await participantRepo.find({ order: { slot_no: 'ASC' } });
  const total = rows.length;
  const maxSlot = rows.reduce((m, r) => Math.max(m, r.slot_no), 0);
  const codes = new Set(rows.map((r) => r.code));
  const malformed = rows.filter((r) => !CODE_PATTERN.test(r.code)).length;

  const failures: string[] = [];
  if (total > quota) failures.push(`COUNT(*)=${total} exceeds quota ${quota}`);
  if (total !== expectedTotal) failures.push(`COUNT(*)=${total}, expected ${expectedTotal}`);
  // Contiguity (MAX == COUNT) only holds on a table nothing was ever deleted from,
  // i.e. when this run started clean. UQ(slot_no) already rules out duplicates.
  if (existingOthers === 0 && maxSlot !== total)
    failures.push(`MAX(slot_no)=${maxSlot} != COUNT(*)=${total} (gap/duplicate)`);
  if (codes.size !== total) failures.push(`codes not unique: ${codes.size} distinct of ${total}`);
  if (malformed > 0) failures.push(`${malformed} malformed code(s)`);
  if (granted + refused !== CONCURRENT_USERS) {
    failures.push(`granted(${granted}) + refused(${refused}) != ${CONCURRENT_USERS}`);
  }

  console.log('[soft-launch-smoke] Result:');
  console.log(`  concurrent:  ${CONCURRENT_USERS} (${elapsed} ms)`);
  console.log(`  granted:     ${granted}`);
  console.log(`  refused:     ${refused}`);
  console.log(`  total rows:  ${total} / quota ${quota}`);
  console.log(`  max slot:    ${maxSlot}`);
  console.log(`  unique code: ${codes.size}`);

  // Release the fixture slots so local manual QA still has quota available.
  await participantRepo.delete({ user_id: In(qaUserIds) });
  console.log(`  cleanup:     removed ${granted} QA allocation(s); QA users kept`);

  if (failures.length > 0) {
    throw new Error(`[soft-launch-smoke] FAILED:\n  - ${failures.join('\n  - ')}`);
  }
  console.log('[soft-launch-smoke] PASS — quota never exceeded, codes unique.');
}
