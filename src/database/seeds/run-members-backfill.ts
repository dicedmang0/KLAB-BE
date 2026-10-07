import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Member } from '../../modules/members/entities/member.entity';
import { MembersService } from '../../modules/members/members.service';

/**
 * One-off repair: create the missing `members` profile for MEMBER-role users
 * registered on one WIB calendar date (accounts created before registration
 * started writing users + members atomically).
 *
 *   npm run members:backfill -- --date=2026-10-07 --dry-run
 *   npm run members:backfill -- --date=2026-10-07 --apply
 *
 * Compiled (no ts-node, e.g. on the deployed image):
 *   node dist/database/seeds/run-members-backfill.js --date=2026-10-07 --dry-run
 *
 * - Exactly one of --dry-run / --apply is required; nothing defaults to writing.
 * - Profiles are created by MembersService.ensureForUser (the same mapping and
 *   defaults as registration and the lazy first-booking path), one transaction
 *   per user. Re-running is a no-op: selected users already have a member row.
 * - Touches `members` only — never soft-launch, packages, bookings, credits.
 * - Targets DATABASE_URL (process env wins over .env). The target host/database
 *   is printed before anything else; check it before using --apply.
 */

export interface BackfillArgs {
  date: string;
  apply: boolean;
}

export const USAGE =
  'Usage: npm run members:backfill -- --date=YYYY-MM-DD (--dry-run | --apply)\n' +
  '  --date     calendar date in Asia/Jakarta (WIB, UTC+07:00)\n' +
  '  --dry-run  list the users that would be repaired; no writes\n' +
  '  --apply    create the missing member profiles';

export function parseArgs(argv: string[]): BackfillArgs {
  let date: string | undefined;
  let dryRun = false;
  let apply = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--apply') apply = true;
    else if (arg.startsWith('--date=')) date = arg.slice('--date='.length);
    else throw new Error(`Unknown argument "${arg}".`);
  }
  if (dryRun === apply) throw new Error('Pass exactly one of --dry-run or --apply.');
  if (!date || !isCalendarDate(date)) {
    throw new Error('--date=YYYY-MM-DD is required and must be a real calendar date.');
  }
  return { date, apply };
}

function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date; // rejects 2026-02-30
}

/** [start, end) of a WIB calendar day as instants. WIB is a fixed UTC+07:00 (no DST). */
export function wibDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+07:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/**
 * MEMBER-role users with no members row, registered inside [$1, $2).
 * `users.created_at` is `timestamp without time zone` filled by DEFAULT now(),
 * i.e. wall-clock time in the DB session TimeZone (UTC on production). Casting
 * it to timestamptz interprets it in that same TimeZone, so the comparison
 * against the WIB bounds is exact whatever the DB or OS timezone is.
 */
export const SELECT_MISSING_SQL = `
  SELECT u.id, u.email, u.created_at::timestamptz AS registered_at
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN members m ON m.user_id = u.id
  WHERE r.name = 'member'
    AND m.id IS NULL
    AND u.created_at::timestamptz >= $1::timestamptz
    AND u.created_at::timestamptz <  $2::timestamptz
  ORDER BY u.created_at, u.id`;

interface Candidate {
  id: string;
  email: string;
  registered_at: Date;
}

export interface BackfillResult {
  selected: number;
  created: number;
  existed: number;
  failed: { userId: string; error: string }[];
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain ?? ''}`;
}

export async function backfillMembers(
  ds: DataSource,
  args: BackfillArgs,
  log: (line: string) => void = console.log,
): Promise<BackfillResult> {
  const { start, end } = wibDayRange(args.date);
  const [{ timezone }] = await ds.query(`SELECT current_setting('TimeZone') AS timezone`);
  log(`Date (WIB):  ${args.date}  [${start.toISOString()} .. ${end.toISOString()})`);
  log(`DB TimeZone: ${timezone} (users.created_at is read in this zone)`);

  const candidates: Candidate[] = await ds.query(SELECT_MISSING_SQL, [
    start.toISOString(),
    end.toISOString(),
  ]);
  log(`Found: ${candidates.length} member user(s) without a member profile`);
  for (const c of candidates) {
    log(`  ${c.id}  ${maskEmail(c.email)}  registered ${new Date(c.registered_at).toISOString()}`);
  }

  const result: BackfillResult = {
    selected: candidates.length,
    created: 0,
    existed: 0,
    failed: [],
  };
  if (!args.apply) {
    log('Dry run only. No database changes made.');
    return result;
  }

  // ensureForUser only uses the manager it is given; the repository is unused here.
  const members = new MembersService(ds.getRepository(Member));
  for (const c of candidates) {
    try {
      // One short transaction per user: a failure affects only that user, and
      // UQ(members.user_id) keeps a concurrent first booking from duplicating it.
      const created = await ds.transaction(async (manager) => {
        if (await manager.exists(Member, { where: { user_id: c.id } })) return false;
        await members.ensureForUser(manager, c.id);
        return true;
      });
      if (created) result.created++;
      else result.existed++;
    } catch (e) {
      // A concurrent insert aborts our transaction on UQ(user_id); the row now exists.
      if (await ds.getRepository(Member).exists({ where: { user_id: c.id } })) {
        result.existed++;
      } else {
        const error = e instanceof Error ? e.message : String(e);
        result.failed.push({ userId: c.id, error });
        log(`  FAILED ${c.id}: ${error}`);
      }
    }
  }
  log(`Selected: ${result.selected}`);
  log(`Created: ${result.created}`);
  log(`Already existed / raced: ${result.existed}`);
  log(`Failed: ${result.failed.length}`);
  return result;
}

/** host:port/database from DATABASE_URL — never the credentials. */
function describeTarget(url: string | undefined): string {
  if (!url) return '(DATABASE_URL not set)';
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function main(): Promise<void> {
  let args: BackfillArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`[members-backfill] ${e instanceof Error ? e.message : e}\n\n${USAGE}`);
    process.exit(2);
  }

  // Loaded here, not at import time: data-source runs dotenv.config().
  const { AppDataSource } = await import('../data-source');
  console.log('Members Backfill');
  console.log(`Mode:        ${args.apply ? 'APPLY (writes)' : 'dry run (read-only)'}`);
  console.log(`Target DB:   ${describeTarget(process.env.DATABASE_URL)}`);
  await AppDataSource.initialize();
  try {
    const result = await backfillMembers(AppDataSource, args);
    if (result.failed.length) process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[members-backfill] Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
