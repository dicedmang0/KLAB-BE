import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { seedWaitlistSmoke } from './waitlist-smoke.seed';

/**
 * LOCAL/DEV-ONLY runner for the waitlist smoke fixture.
 *
 *   npm run seed:waitlist-smoke
 *
 * Kept separate from `npm run seed` (RBAC) so it never ships fixture data into a
 * production seed run. Safe to run multiple times — see waitlist-smoke.seed.ts.
 */
async function main(): Promise<void> {
  console.log('[waitlist-smoke] Connecting to database...');
  await AppDataSource.initialize();

  try {
    await seedWaitlistSmoke(AppDataSource);
    console.log('[waitlist-smoke] Done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[waitlist-smoke] Failed:', err);
  process.exit(1);
});
