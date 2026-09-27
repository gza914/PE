/** Calendar helpers. Game time is an absolute hour count from campaign start. */
import type { Tuning } from '../data/schemas';

export const HOURS_PER_DAY = 24;

export function dayOf(hour: number): number {
  return Math.floor(hour / HOURS_PER_DAY);
}

export function hourOfDay(hour: number): number {
  return hour % HOURS_PER_DAY;
}

function startMs(tuning: Tuning): number {
  return Date.parse(`${tuning.clock.startDate}T00:00:00Z`);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(hour: number, tuning: Tuning): number {
  return new Date(startMs(tuning) + hour * 3_600_000).getUTCDay();
}

export function isNight(hour: number, tuning: Tuning): boolean {
  const h = hourOfDay(hour);
  const { nightStartHour: start, nightEndHour: end } = tuning.clock;
  return start > end ? h >= start || h < end : h >= start && h < end;
}

export function isPayrollHour(hour: number, tuning: Tuning): boolean {
  return weekday(hour, tuning) === tuning.clock.payrollWeekday && hourOfDay(hour) === tuning.clock.payrollHour;
}

export function isIncomeHour(hour: number, tuning: Tuning): boolean {
  return hourOfDay(hour) === tuning.clock.incomeSettleHour;
}

/** e.g. "Mon 9 Sep 2024 · 06:00 · Day 0". */
export function formatDateTime(hour: number, tuning: Tuning): string {
  const d = new Date(startMs(tuning) + hour * 3_600_000);
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${date} · ${hh}:00 · Day ${dayOf(hour)}`;
}
