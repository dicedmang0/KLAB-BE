import { BadRequestException } from '@nestjs/common';

// Machine-readable codes surfaced via the global exception filter (`{ message, code }`).
export const SCHEDULE_INVALID_TIME_RANGE = 'SCHEDULE_INVALID_TIME_RANGE';
export const SCHEDULE_INVALID_TIME_INCREMENT = 'SCHEDULE_INVALID_TIME_INCREMENT';
export const SCHEDULE_ROOM_CONFLICT = 'SCHEDULE_ROOM_CONFLICT';
export const SCHEDULE_INSTRUCTOR_CONFLICT = 'SCHEDULE_INSTRUCTOR_CONFLICT';

// Studio wall-clock is Asia/Jakarta (WIB, UTC+7, no DST), so a fixed offset is exact.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

const toWib = (d: Date) => new Date(d.getTime() + WIB_OFFSET_MS).toISOString();

/** WIB calendar date, e.g. "2026-10-22". */
export function wibDateKey(d: Date): string {
  return toWib(d).slice(0, 10);
}

/** WIB wall-clock time, e.g. "18:30". */
export function wibTime(d: Date): string {
  return toWib(d).slice(11, 16);
}

/**
 * Rejects (never rounds) a time that is not on a 5-minute boundary. WIB is a
 * whole number of 5-minute steps from UTC, so checking the instant is exact and
 * also rejects stray seconds/milliseconds.
 */
export function assertFiveMinuteStep(value: Date, label: 'Start' | 'End'): void {
  if (value.getTime() % FIVE_MINUTES_MS !== 0) {
    throw new BadRequestException({
      message: `${label} time must be on a 5-minute step (e.g. 18:30, 18:35); got ${wibTime(value)} WIB.`,
      code: SCHEDULE_INVALID_TIME_INCREMENT,
    });
  }
}

/** End must be after start and on the same WIB calendar date. */
export function assertSameDayRange(start: Date, end: Date): void {
  if (start >= end) {
    throw new BadRequestException({
      message: 'End time must be after the start time.',
      code: SCHEDULE_INVALID_TIME_RANGE,
    });
  }
  if (wibDateKey(start) !== wibDateKey(end)) {
    throw new BadRequestException({
      message: 'A session must start and end on the same day (WIB).',
      code: SCHEDULE_INVALID_TIME_RANGE,
    });
  }
}
