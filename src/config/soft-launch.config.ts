import { registerAs } from '@nestjs/config';

/**
 * Soft-launch window + participant quota. Dates are ISO-8601 strings carrying
 * an explicit offset (e.g. `2026-09-20T00:00:00+07:00` for WIB) so they parse to
 * exact instants regardless of the server timezone. `end` is inclusive.
 *
 * When `enabled` is false every soft-launch code path is a no-op and booking
 * behaves exactly as before the feature existed.
 */
export interface SoftLaunchConfig {
  enabled: boolean;
  start: Date | null;
  end: Date | null;
  quota: number;
}

function parseDate(name: string, raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${name} is not a valid ISO-8601 date: "${raw}"`);
  }
  return d;
}

export default registerAs('softLaunch', (): SoftLaunchConfig => {
  const enabled = (process.env.SOFT_LAUNCH_ENABLED ?? 'false').toLowerCase() === 'true';
  const start = parseDate('SOFT_LAUNCH_START', process.env.SOFT_LAUNCH_START);
  const end = parseDate('SOFT_LAUNCH_END', process.env.SOFT_LAUNCH_END);
  const quota = parseInt(process.env.SOFT_LAUNCH_QUOTA ?? '80', 10);

  if (enabled) {
    if (!start || !end) {
      throw new Error(
        'SOFT_LAUNCH_START and SOFT_LAUNCH_END are required when SOFT_LAUNCH_ENABLED=true',
      );
    }
    if (start.getTime() >= end.getTime()) {
      throw new Error('SOFT_LAUNCH_START must be before SOFT_LAUNCH_END');
    }
  }

  return { enabled, start, end, quota };
});
