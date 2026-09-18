import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { seedSoftLaunchSmoke } from './soft-launch-smoke.seed';

/**
 * Local/dev-only soft-launch quota concurrency check:
 *
 *   npm run seed:soft-launch-smoke
 *
 * Optional: SOFT_LAUNCH_SMOKE_USERS (default 100), SOFT_LAUNCH_QUOTA (default 80).
 * Exits non-zero if the quota is ever exceeded. See soft-launch-smoke.seed.ts.
 */
async function main(): Promise<void> {
  console.log('[soft-launch-smoke] Connecting to database...');
  await AppDataSource.initialize();

  try {
    await seedSoftLaunchSmoke(AppDataSource);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[soft-launch-smoke] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
