/**
 * AI. The full design is a three-layer utility AI (GDD "AI"); until it lands,
 * this runs the GDD's fallback: scripted logistics traffic. AI lieutenants send
 * crews on supply runs between their network's plazas and bring them home, so
 * the roads carry traffic worth watching. The AI issues the same Commands the
 * player does and plans with only its own network's knowledge.
 */
import type { Command } from '../commands';
import type { SimContext } from '../context';
import { sortedCrewIds } from '../crews';
import { crewNetwork, networkOf, ownedBy } from '../network';
import { chance, pick } from '../rng';
import { nearestNode, travelHours } from '../routing';
import type { CrewState, Id, RoutePreference } from '../state';

/** Stable per-character offset so AI checks are staggered across hours. */
function stagger(id: Id, interval: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % interval;
}

function preferenceFor(ctx: SimContext, leader: Id): RoutePreference {
  const traits = ctx.state.characters[leader]?.traits ?? [];
  if (traits.includes('impulsivo')) return 'fastest';
  if (traits.includes('calculador') || traits.includes('paranoico') || traits.includes('discreto')) return 'safest';
  return 'balanced';
}

/** Runs every hour; returns commands to apply at once. */
export function runAi(ctx: SimContext): Command[] {
  const { state, content } = ctx;
  const { ai } = content.tuning;
  const cmds: Command[] = [];
  for (const id of sortedCrewIds(state)) {
    const crew = state.crews[id]!;
    const owner = state.characters[crew.owner];
    if (!owner || crew.owner === state.playerId || owner.status !== 'free') continue;
    if ((state.hour + stagger(crew.id, ai.operationalIntervalHours)) % ai.operationalIntervalHours !== 0) continue;
    if (crew.location.kind !== 'node' || (crew.order.type !== 'garrison' && crew.order.type !== 'idle')) continue;
    if (Object.values(state.crews).some((c) => c.order.type === 'escort' && c.order.crew === crew.id)) continue;
    const cmd = crew.location.node && state.nodes[crew.location.node]?.owner === crew.owner ? supplyRun(ctx, crew) : returnHome(ctx, crew);
    if (cmd) cmds.push(cmd);
  }
  return cmds;
}

function supplyRun(ctx: SimContext, crew: CrewState): Command | null {
  const { state, content } = ctx;
  const { ai } = content.tuning;
  if (crew.men > ai.trafficMaxMen || !chance(state.rng, ai.trafficChancePerCheck)) return null;
  const net = crewNetwork(state, crew);
  const here = crew.location.kind === 'node' ? crew.location.node : null;
  const preference = preferenceFor(ctx, crew.leader);
  const hours = travelHours(state, content, { crews: [crew], from: crew.location, preference, departHour: state.hour, viewer: net });
  const targets = content.nodes
    .map((n) => n.id)
    .filter((n) => n !== here && ownedBy(state, n, net) && (hours.get(n) ?? Infinity) <= ai.trafficMaxTripHours);
  if (!targets.length) return null;
  return { type: 'order_crew', issuer: crew.owner, crew: crew.id, order: { type: 'move', destination: pick(state.rng, targets), preference } };
}

function returnHome(ctx: SimContext, crew: CrewState): Command | null {
  const { state, content } = ctx;
  if (!chance(state.rng, content.tuning.ai.returnHomeChancePerCheck)) return null;
  const home = nearestNode(
    state,
    content,
    { crews: [crew], from: crew.location, departHour: state.hour, viewer: networkOf(state, crew.owner) },
    (n) => state.nodes[n]?.owner === crew.owner,
  );
  if (!home) return null;
  return { type: 'order_crew', issuer: crew.owner, crew: crew.id, order: { type: 'move', destination: home, preference: preferenceFor(ctx, crew.leader) } };
}
