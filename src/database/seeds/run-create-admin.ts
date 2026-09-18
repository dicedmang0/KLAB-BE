import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { seedAdmin } from './create-admin.seed';

/**
 * One-time admin bootstrap/reset, driven entirely by env vars:
 *
 *   npm run admin:create
 *
 * Required: ADMIN_EMAIL, ADMIN_PASSWORD (+ ADMIN_FULL_NAME when creating).
 * Optional: ADMIN_ROLE (defaults to "admin"; must be an existing admin-tier role).
 *
 * Idempotent — safe to run multiple times; see create-admin.seed.ts.
 */
async function main(): Promise<void> {
  console.log('[admin-seed] Connecting to database...');
  await AppDataSource.initialize();

  try {
    await seedAdmin(AppDataSource);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[admin-seed] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
