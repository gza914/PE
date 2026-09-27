/**
 * Paradox-style events: mean-time-to-happen rolls, scheduled events, and
 * option effects.
 * GDD: "Event system". Not implemented yet: the scaffold only fixes the call sites.
 */
import type { SimContext } from '../context';

/** Runs every hour: fires scheduled events that are due. */
export function runScheduledEvents(ctx: SimContext): void {
  void ctx;
}

/** Runs once per day: rolls mean-time-to-happen for eligible events. */
export function runEventsDaily(ctx: SimContext): void {
  void ctx;
}
