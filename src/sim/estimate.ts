/**
 * Sightings as ranges (GDD "Intelligence as estimates"). A source files a most
 * likely head count and the range it supports; several sources on the same
 * crew narrow the range, and age widens it again. UI and AI read the same
 * ranges, so both can be fooled the same way.
 */
import type { Tuning } from '../data/schemas';
import { randRange, type RngState } from './rng';
import type { Report, ReportSource } from './state';

export interface Range {
  /** Most likely. */
  men: number;
  low: number;
  high: number;
}

/** A sighting of `truth` men by a source with half-width `spread`: noisy estimate and its range. */
export function sample(rng: RngState, tuning: Tuning, truth: number, spread: number): Range {
  if (truth <= 0) return { men: 0, low: 0, high: 0 };
  const err = spread * tuning.intel.errorShareOfSpread;
  const men = Math.max(1, Math.round(truth * (1 + randRange(rng, -err, err))));
  return around(men, spread);
}

/** The range a source with half-width `spread` puts around an estimate. */
export function around(men: number, spread: number): Range {
  return { men, low: Math.max(1, Math.floor(men * (1 - spread))), high: Math.ceil(men * (1 + spread)) };
}

export function spreadOf(tuning: Tuning, source: ReportSource): number {
  return tuning.intel.spread[source];
}

/** How much a report's range has widened with age. */
export function widening(tuning: Tuning, ageHours: number): number {
  return Math.min(tuning.intel.maxWiden, 1 + Math.max(0, ageHours) * tuning.intel.widenPerHour);
}

/** One report's range at `hour`. */
export function aged(tuning: Tuning, r: Report, hour: number): Range {
  const w = widening(tuning, hour - r.hour);
  return { men: r.men, low: Math.max(r.men > 0 ? 1 : 0, Math.floor(r.low / w)), high: Math.ceil(r.high * w) };
}

/**
 * Several reports on the same crew: the overlap of their aged ranges, with the
 * most likely count weighted toward the tighter sources. When sources disagree
 * outright, the newest wins.
 */
export function combine(tuning: Tuning, reports: readonly Report[], hour: number): Range {
  if (!reports.length) return { men: 0, low: 0, high: 0 };
  const newest = reports.reduce((a, b) => (b.hour > a.hour || (b.hour === a.hour && b.id > a.id) ? b : a));
  const ranges = reports.map((r) => aged(tuning, r, hour));
  let low = Math.max(...ranges.map((r) => r.low));
  let high = Math.min(...ranges.map((r) => r.high));
  if (low > high) {
    const n = aged(tuning, newest, hour);
    return n;
  }
  let sum = 0;
  let weight = 0;
  for (const r of ranges) {
    const w = 1 / (r.high - r.low + 1);
    sum += r.men * w;
    weight += w;
  }
  const men = Math.min(high, Math.max(low, Math.round(sum / weight)));
  if (men === 0) low = high = 0;
  return { men, low, high };
}

/** Add up independent crews' ranges. */
export function total(ranges: readonly Range[]): Range {
  return ranges.reduce((a, r) => ({ men: a.men + r.men, low: a.low + r.low, high: a.high + r.high }), { men: 0, low: 0, high: 0 });
}

/** "25–45 (likely 35)", or a plain number when the range is exact. */
export function fmtRange(r: Range): string {
  if (r.low === r.high) return `${r.men}`;
  return `${r.low}–${r.high} (likely ${r.men})`;
}

/** Compact form for map labels. */
export function shortRange(r: Range): string {
  if (r.low === r.high) return `${r.men}`;
  return `${r.low}–${r.high}`;
}
