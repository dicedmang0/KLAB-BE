import { BadRequestException } from '@nestjs/common';
import {
  SCHEDULE_INVALID_TIME_INCREMENT,
  SCHEDULE_INVALID_TIME_RANGE,
  assertFiveMinuteStep,
  assertSameDayRange,
  wibDateKey,
  wibTime,
} from './schedule-rules';

const wib = (s: string) => new Date(`${s}+07:00`);

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as { code?: string }).code;
  }
  return undefined;
}

describe('schedule rules', () => {
  it('converts UTC instants to WIB wall-clock', () => {
    const d = new Date('2026-10-22T11:30:00.000Z');
    expect(wibDateKey(d)).toBe('2026-10-22');
    expect(wibTime(d)).toBe('18:30');
    expect(wib('2026-10-22T18:30:00').toISOString()).toBe('2026-10-22T11:30:00.000Z');
  });

  describe('assertFiveMinuteStep', () => {
    it.each(['18:00', '18:05', '18:30', '18:35', '18:55'])('accepts %s', (t) => {
      expect(
        codeOf(() => assertFiveMinuteStep(wib(`2026-10-22T${t}:00`), 'Start')),
      ).toBeUndefined();
    });

    it.each(['18:01', '18:29', '18:32'])('rejects %s without rounding', (t) => {
      expect(codeOf(() => assertFiveMinuteStep(wib(`2026-10-22T${t}:00`), 'Start'))).toBe(
        SCHEDULE_INVALID_TIME_INCREMENT,
      );
    });

    it('rejects stray seconds on an otherwise valid minute', () => {
      expect(codeOf(() => assertFiveMinuteStep(wib('2026-10-22T18:30:15'), 'End'))).toBe(
        SCHEDULE_INVALID_TIME_INCREMENT,
      );
    });
  });

  describe('assertSameDayRange', () => {
    it('accepts 18:30 → 19:20', () => {
      expect(
        codeOf(() => assertSameDayRange(wib('2026-10-22T18:30:00'), wib('2026-10-22T19:20:00'))),
      ).toBeUndefined();
    });

    it('rejects end before start and start == end', () => {
      expect(
        codeOf(() => assertSameDayRange(wib('2026-10-22T19:20:00'), wib('2026-10-22T18:30:00'))),
      ).toBe(SCHEDULE_INVALID_TIME_RANGE);
      expect(
        codeOf(() => assertSameDayRange(wib('2026-10-22T18:30:00'), wib('2026-10-22T18:30:00'))),
      ).toBe(SCHEDULE_INVALID_TIME_RANGE);
    });

    it('rejects 23:30 → 00:20 next day even though both are the same UTC date', () => {
      const start = wib('2026-10-22T23:30:00'); // 16:30Z
      const end = wib('2026-10-23T00:20:00'); // 17:20Z, same UTC day
      expect(start.toISOString().slice(0, 10)).toBe(end.toISOString().slice(0, 10));
      expect(codeOf(() => assertSameDayRange(start, end))).toBe(SCHEDULE_INVALID_TIME_RANGE);
    });

    it('accepts an early-morning WIB session that spans two UTC dates', () => {
      const start = wib('2026-10-22T06:00:00'); // 2026-10-21T23:00Z
      const end = wib('2026-10-22T07:30:00'); // 2026-10-22T00:30Z
      expect(codeOf(() => assertSameDayRange(start, end))).toBeUndefined();
    });
  });
});
