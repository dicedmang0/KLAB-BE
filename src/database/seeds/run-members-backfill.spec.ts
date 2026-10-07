import { maskEmail, parseArgs, wibDayRange } from './run-members-backfill';

describe('members backfill CLI', () => {
  it('requires exactly one of --dry-run / --apply', () => {
    expect(parseArgs(['--date=2026-10-07', '--dry-run'])).toEqual({
      date: '2026-10-07',
      apply: false,
    });
    expect(parseArgs(['--apply', '--date=2026-10-07'])).toEqual({
      date: '2026-10-07',
      apply: true,
    });
    expect(() => parseArgs(['--date=2026-10-07'])).toThrow(/exactly one/);
    expect(() => parseArgs(['--date=2026-10-07', '--dry-run', '--apply'])).toThrow(/exactly one/);
  });

  it('rejects missing, malformed and impossible dates and unknown flags', () => {
    expect(() => parseArgs(['--dry-run'])).toThrow(/--date/);
    expect(() => parseArgs(['--dry-run', '--date=07-10-2026'])).toThrow(/--date/);
    expect(() => parseArgs(['--dry-run', '--date=2026-02-30'])).toThrow(/--date/);
    expect(() => parseArgs(['--dry-run', '--date=2026-10-07', '--all'])).toThrow(/Unknown/);
  });

  it('maps a WIB calendar date to [00:00 WIB, next 00:00 WIB) independent of process TZ', () => {
    const { start, end } = wibDayRange('2026-10-07');
    expect(start.toISOString()).toBe('2026-10-06T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-07T17:00:00.000Z');
  });

  it('masks emails in output', () => {
    expect(maskEmail('alice@example.com')).toBe('al***@example.com');
  });
});
