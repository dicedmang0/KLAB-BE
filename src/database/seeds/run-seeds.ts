import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { seedRbac } from './rbac.seed';

async function main(): Promise<void> {
  console.log('[seeds] Connecting to database...');
  await AppDataSource.initialize();

  try {
    await seedRbac(AppDataSource);
    console.log('[seeds] Done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[seeds] Failed:', err);
  process.exit(1);
});
