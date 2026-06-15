import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { seedPhase11eSmoke } from './phase-11e-smoke.seed';

/**
 * LOCAL/DEV-ONLY runner for the Phase 11E booking/waitlist smoke fixture.
 *
 *   npm run seed:phase-11e-smoke
 *
 * Kept separate from `npm run seed` (RBAC) so fixture data never ships into a
 * production seed run. Safe to run multiple times — see phase-11e-smoke.seed.ts.
 *
 * Prerequisites:
 *   1. DATABASE_URL is set in .env
 *   2. Migrations have been applied (npm run migration:run)
 *   3. RBAC seed has been run (npm run seed) so the "member" role exists
 */
async function main(): Promise<void> {
  console.log('[phase-11e-smoke] Connecting to database...');
  await AppDataSource.initialize();

  try {
    await seedPhase11eSmoke(AppDataSource);
    console.log('[phase-11e-smoke] Done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[phase-11e-smoke] Failed:', err);
  process.exit(1);
});
