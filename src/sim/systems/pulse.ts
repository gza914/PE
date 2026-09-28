/**
 * The war's pulse, once a day: quiet days let calentura and exhaustion decay,
 * and each region's war state is set from the day's fighting. Supply
 * regenerates from income once the economy lands. GDD: "Time and tempo".
 */
import type { SimContext } from '../context';
import { crewNetwork } from '../network';
import type { WarState } from '../state';
import { world } from '../world';

export function runPulseDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const { pulse } = content.tuning;
  const w = world(content);
  const majors = new Set(content.factions.filter((f) => f.kind === 'major').map((f) => f.id));

  // Which major factions have crews in each region right now.
  const present = new Map<string, Set<string>>();
  for (const c of Object.values(state.crews)) {
    const node = c.location.kind === 'node' ? c.location.node : c.location.from;
    const region = w.node(node).region;
    const net = crewNetwork(state, c);
    if (!majors.has(net)) continue;
    present.set(region, (present.get(region) ?? new Set()).add(net));
  }

  for (const id of Object.keys(state.regions).sort()) {
    const r = state.regions[id]!;
    const hours = r.combatHoursToday;
    let ws: WarState = 'quiet';
    if (hours >= pulse.offensiveCombatHours) ws = 'offensive';
    else if (hours >= pulse.skirmishingCombatHours) ws = 'skirmishing';
    else if ((present.get(id)?.size ?? 0) >= 2) ws = 'tense';
    r.warState = ws;
    if (hours <= pulse.quietDayMaxCombatHours) {
      r.quietDays += 1;
      r.calentura = Math.max(0, r.calentura - content.tuning.state.calenturaDecayPerQuietDay);
    } else {
      r.quietDays = 0;
    }
    r.combatHoursWeek = r.combatHoursWeek * content.tuning.events.combatWeekKeep + hours;
    r.combatHoursToday = 0;
  }

  for (const id of Object.keys(state.factions).sort()) {
    const f = state.factions[id]!;
    if (f.combatHoursToday <= pulse.quietDayMaxCombatHours) {
      f.quietDays += 1;
      f.exhaustion = Math.max(0, f.exhaustion - pulse.exhaustionDecayPerQuietDay);
    } else {
      f.quietDays = 0;
    }
    f.combatHoursToday = 0;
  }
}
