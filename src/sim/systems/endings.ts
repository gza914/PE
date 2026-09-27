/**
 * End triggers and scoring. Only the time cap is implemented so far.
 * GDD: "Endings and scoring".
 */
import { dayOf } from '../clock';
import { pushFeed, type SimContext } from '../context';

export function checkEndings(ctx: SimContext): void {
  const { state, content } = ctx;
  if (state.ended) return;
  if (dayOf(state.hour) >= content.tuning.clock.maxDays) {
    state.ended = { reason: 'time_cap', hour: state.hour, winner: null };
    pushFeed(state, 'critical', `Day ${content.tuning.clock.maxDays}: the war ends without a decision.`);
  }
}
