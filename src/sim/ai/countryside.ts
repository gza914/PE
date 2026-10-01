/**
 * AI in the countryside (GDD "Opportunism", "Sweeps"): crews camped in the
 * hills strike the town when they believe they can beat its garrison, and
 * holders sweep their hills when a rival's influence there grows.
 */
import type { Command } from '../commands';
import type { SimContext } from '../context';
import { hasCountryside } from '../countryside';
import { groupOf, sortedCrewIds } from '../crews';
import { crewNetwork, networkOf } from '../network';
import { groupPower } from '../power';
import { onDuty } from '../requests';
import { chance } from '../rng';
import { withinHops, type Intel } from './intel';
import { isAi, majorFactions, stagger } from './util';

export function runCountrysideAi(ctx: SimContext, intel: Intel): Command[] {
  const { state, content } = ctx;
  const t = content.tuning.countryside.ai;
  const every = content.tuning.ai.operationalIntervalHours;
  const cmds: Command[] = [];
  // Opportunism: campers strike a weak garrison.
  for (const id of sortedCrewIds(state)) {
    const c = state.crews[id]!;
    if (c.order.type !== 'camp' || c.battle !== null || !isAi(state, c.owner) || c.location.kind !== 'node') continue;
    if ((state.hour + stagger(`camp:${c.id}`, every)) % every !== 0) continue;
    const node = c.location.node;
    const owner = state.nodes[node]?.owner;
    const net = crewNetwork(state, c);
    if (!owner || networkOf(state, owner) === net) continue;
    const mine = groupPower(state, content, groupOf(state, c));
    if (mine >= t.opportunismRatio * intel.defense(net, node).power) cmds.push({ type: 'order_crew', issuer: c.owner, crew: c.id, order: { type: 'raid', target: node, preference: 'fastest' } });
  }
  // Remnants: after losing a plaza, an idle crew nearby (often the one that fell back) takes to its hills.
  for (const f of majorFactions(content)) {
    const fs = state.factions[f];
    if (!fs || (state.hour + stagger(`remnant:${f}`, every)) % every !== 0) continue;
    for (const lost of fs.warPlan.lost) {
      if (state.hour - lost.at > t.remnantWithinDays * 24 || !hasCountryside(content, lost.node)) continue;
      const owner = state.nodes[lost.node]?.owner;
      if (!owner || networkOf(state, owner) === f) continue;
      if ((state.countryside[lost.node]?.[f] ?? 0) < t.remnantMinInfluence) continue;
      const camping = Object.values(state.crews).some((c) => c.order.type === 'camp' && c.location.kind === 'node' && c.location.node === lost.node && crewNetwork(state, c) === f);
      const enRoute = Object.values(state.crews).some((c) => c.order.type === 'move' && c.order.onArrive === 'camp' && c.order.destination === lost.node && crewNetwork(state, c) === f);
      if (camping || enRoute || !chance(state.rng, t.remnantChancePerCheck)) continue;
      const near = withinHops(content, lost.node, t.remnantMaxHops);
      const spare = sortedCrewIds(state)
        .map((x) => state.crews[x]!)
        .filter((c) => crewNetwork(state, c) === f && isAi(state, c.owner) && c.battle === null && c.men >= t.remnantMinMen && c.order.type === 'idle' && c.location.kind === 'node' && near.has(c.location.node) && !onDuty(state, c.id))
        .sort((a, b) => b.men - a.men || (a.id < b.id ? -1 : 1))[0];
      if (spare) cmds.push({ type: 'order_crew', issuer: spare.owner, crew: spare.id, order: { type: 'move', destination: lost.node, preference: 'safest', onArrive: 'camp' } });
    }
  }
  // Sweeps: holders clear their hills.
  for (const n of content.nodes) {
    if (!hasCountryside(content, n.id)) continue;
    const owner = state.nodes[n.id]!.owner;
    if (!owner || !isAi(state, owner)) continue;
    if ((state.hour + stagger(`sweep:${n.id}`, every)) % every !== 0) continue;
    const net = networkOf(state, owner);
    const z = state.countryside[n.id] ?? {};
    const rival = Math.max(0, ...Object.keys(z).filter((k) => k !== net).map((k) => z[k]!));
    if (rival < t.sweepInfluence || !chance(state.rng, t.sweepChancePerCheck)) continue;
    const garrison = sortedCrewIds(state)
      .map((x) => state.crews[x]!)
      .filter((c) => c.owner === owner && c.location.kind === 'node' && c.location.node === n.id && c.order.type === 'garrison' && c.battle === null && !onDuty(state, c.id))
      .sort((a, b) => b.men - a.men)[0];
    if (!garrison) continue;
    // Do not walk into a fight it believes it cannot win.
    const known = intel.believedAt(net, n.id).filter((b) => networkOf(state, b.owner) !== net).reduce((m, b) => m + b.men, 0);
    if (garrison.men < known) continue;
    cmds.push({ type: 'sweep', issuer: owner, crew: garrison.id });
  }
  return cmds;
}
