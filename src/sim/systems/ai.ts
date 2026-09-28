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
import { cashOf } from '../money';
import { seats } from '../signature';
import type { ExtortionRate } from '../../data/schemas';
import type { CrewState, Id, RoutePreference } from '../state';
import { weeklyObligations } from './economy';

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
  const cmds: Command[] = runEconomy(ctx);
  for (const id of sortedCrewIds(state)) {
    const crew = state.crews[id]!;
    const owner = state.characters[crew.owner];
    if (!owner || crew.owner === state.playerId || owner.status !== 'free') continue;
    if ((state.hour + stagger(crew.id, ai.operationalIntervalHours)) % ai.operationalIntervalHours !== 0) continue;
    if (crew.location.kind !== 'node' || (crew.order.type !== 'garrison' && crew.order.type !== 'idle')) continue;
    // Crews committed to a Culiacán colonia hold the front.
    if (crew.colonia !== null || crew.battle !== null) continue;
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
  const hours = travelHours(state, content, { crews: [crew], from: crew.location, preference, departHour: state.hour, viewer: net, noPassThrough: rivalPlazas(ctx, net) });
  const targets = content.nodes
    .map((n) => n.id)
    .filter((n) => n !== here && ownedBy(state, n, net) && (hours.get(n) ?? Infinity) <= ai.trafficMaxTripHours);
  if (!targets.length) return null;
  return { type: 'order_crew', issuer: crew.owner, crew: crew.id, order: { type: 'move', destination: pick(state.rng, targets), preference, avoidRivalPlazas: true } };
}

/** Plazas held by any network other than `net`: supply runs go around them. */
export function rivalPlazas(ctx: SimContext, net: string): Id[] {
  return Object.values(ctx.state.nodes)
    .filter((n) => n.owner !== null && networkOf(ctx.state, n.owner) !== net)
    .map((n) => n.id)
    .sort();
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
  return { type: 'order_crew', issuer: crew.owner, crew: crew.id, order: { type: 'move', destination: home, preference: preferenceFor(ctx, crew.leader), avoidRivalPlazas: true } };
}

const RATES: ExtortionRate[] = ['low', 'medium', 'high', 'brutal'];

/**
 * Once a day per AI character: refill crews toward full strength when the
 * money allows, squeeze harder when broke, and ease off where locals turn.
 */
function runEconomy(ctx: SimContext): Command[] {
  const { state, content } = ctx;
  const e = content.tuning.economy;
  const cmds: Command[] = [];
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (id === state.playerId || ch.status === 'dead') continue;
    if ((state.hour + stagger(id, 24)) % 24 !== 12) continue;
    const plazas = Object.values(state.nodes)
      .filter((n) => n.owner === id)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!plazas.length) continue;
    const weekly = weeklyObligations(state, content, id);
    let cash = cashOf(state, id);
    const broke = ch.missedPayrollWeeks > 0 || cash < weekly;

    if (!broke) {
      const reserve = 2 * weekly;
      for (const crew of Object.values(state.crews).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        if (crew.owner !== id || crew.battle !== null || crew.location.kind !== 'node') continue;
        const plaza = state.nodes[crew.location.node];
        if (!plaza || plaza.owner !== id) continue;
        const need = Math.min(crew.establishment - crew.men, Math.floor(plaza.recruits), content.tuning.crews.maxMen - crew.men);
        if (need <= 0) continue;
        const seatsShort = Math.max(0, crew.men + need - seats(crew, content.tuning));
        const pickups = Math.ceil(seatsShort / content.tuning.vehicles.pickup.seats);
        const cost = need * e.recruitment.signingCostPerMan + pickups * content.tuning.vehicles.pickup.cost;
        if (cash - cost < reserve) continue;
        if (pickups > 0) cmds.push({ type: 'buy_vehicles', issuer: id, crew: crew.id, vehicle: 'pickup', count: pickups });
        cmds.push({ type: 'recruit', issuer: id, crew: crew.id, men: need });
        cash -= cost;
      }
    }

    for (const p of plazas) {
      const i = RATES.indexOf(p.extortionRate);
      if (p.support < 25 && i >= 2) cmds.push({ type: 'set_extortion_rate', issuer: id, node: p.id, rate: RATES[i - 1]! });
    }
    if (broke) {
      const richest = [...plazas].sort((a, b) => b.businesses - a.businesses)[0]!;
      const i = RATES.indexOf(richest.extortionRate);
      if (i < 2 && richest.support >= 35) cmds.push({ type: 'set_extortion_rate', issuer: id, node: richest.id, rate: RATES[i + 1]! });
      const watched = [...plazas].sort((a, b) => b.halconCoverage - a.halconCoverage)[0]!;
      if (watched.halconCoverage > 30) cmds.push({ type: 'set_halcon_coverage', issuer: id, node: watched.id, coverage: watched.halconCoverage - 10 });
    }
  }
  return cmds;
}
