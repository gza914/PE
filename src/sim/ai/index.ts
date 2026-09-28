/**
 * The AI (GDD "AI"): three layers that issue the same Commands the player
 * does, planning only from their own network's reports.
 *
 *   strategic    faction heads: war plans, offensives, defense, levies (daily)
 *   operational  lieutenants: requests and initiatives (every few hours, staggered)
 *   tactical     crew leaders in battle (hourly)
 *
 * Plus the economy (daily), the shadow layer (the State, messages, schemes;
 * daily), and logistics traffic for idle crews. AI answers to events run in
 * the event system itself (tuning.ai.layers.events).
 */
import type { Command } from '../commands';
import type { SimContext } from '../context';
import { sortedCrewIds } from '../crews';
import { onDuty } from '../requests';
import { runEconomy } from './economy';
import { Intel } from './intel';
import { returnHome, supplyRun } from './logistics';
import { runOperational } from './operational';
import { runShadow } from './shadow';
import { runStrategic } from './strategic';
import { runTactical } from './tactical';
import { isAi, stagger } from './util';

export function runAi(ctx: SimContext): Command[] {
  const { state, content } = ctx;
  const intel = new Intel(state, content);
  const on = content.tuning.ai.layers;
  const cmds: Command[] = [
    ...(on.tactical ? runTactical(ctx) : []),
    ...(on.strategic ? runStrategic(ctx, intel) : []),
    ...(on.operational ? runOperational(ctx, intel) : []),
    ...(on.economy ? runEconomy(ctx) : []),
    ...(on.shadow ? runShadow(ctx) : []),
  ];
  if (!on.traffic) return cmds;
  // Idle crews that nobody gave a job this hour: supply runs and coming home.
  const busy = new Set(cmds.flatMap((c) => ('crew' in c ? [c.crew] : [])));
  const every = content.tuning.ai.operationalIntervalHours;
  for (const id of sortedCrewIds(state)) {
    const crew = state.crews[id]!;
    const owner = state.characters[crew.owner];
    if (busy.has(id) || !owner || !isAi(state, crew.owner)) continue;
    if ((state.hour + stagger(crew.id, every)) % every !== 0) continue;
    if (crew.location.kind !== 'node' || (crew.order.type !== 'garrison' && crew.order.type !== 'idle')) continue;
    if (crew.colonia !== null || crew.battle !== null || onDuty(state, id)) continue;
    if (Object.values(state.crews).some((c) => c.order.type === 'escort' && c.order.crew === crew.id)) continue;
    const cmd = state.nodes[crew.location.node]?.owner === crew.owner ? supplyRun(ctx, crew) : returnHome(ctx, crew);
    if (cmd) cmds.push(cmd);
  }
  return cmds;
}
