/**
 * Eyes on towns (GDD "Intelligence as estimates"): drones over a town count
 * the street and miss men indoors; informants settle in, report samples every
 * few hours, and may be found out. Both file ordinary Reports with ranges.
 */
import { newId, pushFeed, type SimContext } from './context';
import { groupOf, sortedCrewIds } from './crews';
import { fmtRange, sample, total, type Range } from './estimate';
import { spend } from './money';
import { crewNetwork, networkOf, watchersOf } from './network';
import { addOpinion } from './opinion';
import { charName, leaderName, notifyOwner } from './orders';
import { chance, randInt, randRange } from './rng';
import type { CrewState, Drone, Id, Informant } from './state';
import { report } from './systems/detection';
import { world } from './world';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Why a drone cannot go up over a road or town, or null. */
export function droneBlocked(ctx: SimContext, issuer: Id, road: Id | null, node: Id | null): string | null {
  const { content } = ctx;
  if ((road === null) === (node === null)) return 'pick a road or a town';
  if (road !== null && !content.roads.some((r) => r.id === road)) return `unknown road "${road}"`;
  if (node !== null) {
    const n = content.nodes.find((x) => x.id === node);
    if (!n) return `unknown place "${node}"`;
    if (node === content.culiacan.parentNode) return 'Culiacán is too big for one drone';
    if (n.type === 'border_exit') return 'nothing to watch there';
  }
  if (!ctx.state.characters[issuer]) return 'unknown character';
  return null;
}

export function launchDrone(ctx: SimContext, issuer: Id, road: Id | null, node: Id | null): string | null {
  const { state, content } = ctx;
  const blocked = droneBlocked(ctx, issuer, road, node);
  if (blocked) return blocked;
  const cost = node !== null ? content.tuning.intel.droneTown.cost : content.tuning.detection.droneCost;
  if (!spend(state, content, issuer, cost, 'drones')) return `a drone costs ${money(cost)}`;
  state.drones.push({
    id: newId(state, 'drone'),
    network: networkOf(state, issuer),
    owner: issuer,
    road,
    node,
    launchedAt: state.hour,
    until: state.hour + (node !== null ? content.tuning.intel.droneTown.hours : content.tuning.detection.droneRevealHours),
    rolled: [],
  });
  return null;
}

/** Why `issuer` cannot plant an informant in `node`, or null. */
export function informantBlocked(ctx: SimContext, issuer: Id, node: Id): string | null {
  const { state, content } = ctx;
  const t = content.tuning.intel.informant;
  const def = content.nodes.find((n) => n.id === node);
  if (!def || def.type === 'border_exit') return 'not a town';
  if (node === content.culiacan.parentNode) return 'Culiacán needs a man in every colonia; not yet';
  const net = networkOf(state, issuer);
  const owner = state.nodes[node]?.owner ?? null;
  if (owner !== null && networkOf(state, owner) === net) return 'your side already holds it';
  if (state.informants.some((i) => i.network === net && i.node === node)) return 'your side already has a man there';
  if (state.informants.filter((i) => i.owner === issuer).length >= t.maxPerNetwork) return `you can run at most ${t.maxPerNetwork} informants`;
  return null;
}

export function plantInformant(ctx: SimContext, issuer: Id, node: Id): string | null {
  const { state, content } = ctx;
  const t = content.tuning.intel.informant;
  const blocked = informantBlocked(ctx, issuer, node);
  if (blocked) return blocked;
  if (!spend(state, content, issuer, t.cost, 'informants')) return `an informant costs ${money(t.cost)}`;
  const astucia = state.characters[issuer]?.skills.astucia ?? 0;
  const quality = Math.min(1, randRange(state.rng, t.qualityMin, t.qualityMax) + astucia * t.qualityPerAstucia);
  const activeAt = state.hour + Math.round(t.settleDays * 24);
  state.informants.push({ id: newId(state, 'inf'), network: networkOf(state, issuer), owner: issuer, node, plantedAt: state.hour, activeAt, quality, nextReport: activeAt });
  return null;
}

export function pullInformant(ctx: SimContext, issuer: Id, id: Id): string | null {
  const { state } = ctx;
  const inf = state.informants.find((i) => i.id === id);
  if (!inf) return 'no such informant';
  if (inf.owner !== issuer) return 'not your informant';
  state.informants = state.informants.filter((i) => i.id !== id);
  return null;
}

/** Half-width of an informant's range. */
export function informantSpread(ctx: SimContext, inf: Informant): number {
  const t = ctx.content.tuning.intel.informant;
  return t.spreadAtWorst + (t.spreadAtBest - t.spreadAtWorst) * inf.quality;
}

/** Rival crews in a town, in a fixed order (Culiacán is excluded upstream). */
function rivalsAt(ctx: SimContext, node: Id, net: Id): CrewState[] {
  const { state } = ctx;
  return sortedCrewIds(state)
    .map((id) => state.crews[id]!)
    .filter((c) => c.location.kind === 'node' && c.location.node === node && c.order.type !== 'escort' && crewNetwork(state, c) !== net);
}

/** Hourly: informants report on schedule. */
export function runInformants(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.intel.informant;
  const w = world(content);
  for (const inf of state.informants) {
    if (state.hour < inf.nextReport) continue;
    inf.nextReport = state.hour + t.reportEveryHours;
    const spread = informantSpread(ctx, inf);
    const share = t.sampleAtWorst + (t.sampleAtBest - t.sampleAtWorst) * inf.quality;
    const ranges: Range[] = [];
    for (const leader of rivalsAt(ctx, inf.node, inf.network)) {
      report(ctx, inf.network, groupOf(state, leader), 'informant', 'estimated', inf.node, (c) => {
        const r = sample(state.rng, content.tuning, c.men, spread);
        ranges.push(r);
        return r;
      }, true);
    }
    if (inf.owner !== state.playerId) continue;
    const place = w.node(inf.node).name;
    if (!ranges.length) {
      pushFeed(state, 'routine', `Informant in ${place}: no outside crews in town.`, inf.node, inf.network);
      continue;
    }
    const sum = total(ranges);
    const seen = Math.max(1, Math.round(sum.men * share * randRange(state.rng, 0.7, 1.3)));
    const spot = t.spots[randInt(state.rng, 0, t.spots.length - 1)]!;
    pushFeed(state, 'routine', `Informant in ${place}: ${seen} men at ${spot}. Probably ${fmtRange(sum)} men in town.`, inf.node, inf.network);
  }
}

/** Daily: each informant may be found out. */
export function runInformantsDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.intel.informant;
  const d = t.discovery;
  const w = world(content);
  const caught: Id[] = [];
  for (const inf of state.informants) {
    const holder = state.nodes[inf.node]?.owner ?? null;
    if (holder === null) continue;
    const coverage = watchersOf(state, content, inf.node).find((x) => x.network === networkOf(state, holder))?.coverage ?? 0;
    const astucia = state.characters[holder]?.skills.astucia ?? 0;
    const p = Math.min(d.max, Math.max(0, d.base + d.perCoverage * coverage + d.perAstucia * astucia - d.qualityProtect * inf.quality));
    if (!chance(state.rng, p)) continue;
    caught.push(inf.id);
    const place = w.node(inf.node).name;
    addOpinion(state, content, holder, inf.owner, 'planted_an_informant', t.caughtOpinion, t.caughtOpinionDecayDays);
    if (inf.owner === state.playerId) pushFeed(state, 'important', `Our informant in ${place} was found out. ${charName(ctx, holder)} knows you sent him.`, inf.node, inf.network);
    pushFeed(state, 'important', `${charName(ctx, holder)}'s people caught an informant in ${place}, working for ${charName(ctx, inf.owner)}.`, inf.node, networkOf(state, holder));
  }
  if (caught.length) state.informants = state.informants.filter((i) => !caught.includes(i.id));
  // An informant in a town his side now holds has nothing left to do.
  state.informants = state.informants.filter((i) => {
    const owner = state.nodes[i.node]?.owner ?? null;
    return owner === null || networkOf(state, owner) !== i.network;
  });
}

/** A drone over a town: counts vehicles and men in the street, misses men indoors. */
export function droneOverTown(ctx: SimContext, drone: Drone): void {
  const { state, content } = ctx;
  const t = content.tuning.intel.droneTown;
  if (drone.node === null) return;
  const node = drone.node;
  const mid = (t.streetMin + t.streetMax) / 2;
  const before = state.reports.length;
  const first = state.hour - drone.launchedAt === 1;
  for (const leader of rivalsAt(ctx, node, drone.network)) {
    const group = groupOf(state, leader);
    report(ctx, drone.network, group, 'drone', 'estimated', null, (c) => {
      const street = randRange(state.rng, t.streetMin, t.streetMax) * (c.order.type === 'lie_low' ? t.lyingLowFactor : 1);
      const seen = Math.round(c.men * street);
      if (seen <= 0) return { men: 0, low: 0, high: 0 };
      return { men: Math.round(seen / mid), low: Math.max(seen, Math.floor(seen / t.streetMax)), high: Math.ceil(seen / t.streetMin) };
    });
    if (drone.rolled.includes(leader.id)) continue;
    drone.rolled.push(leader.id);
    const alertness = Math.max(...group.map((c) => c.alertness));
    if (chance(state.rng, (alertness / 100) * t.noticeAlertnessFactor)) {
      notifyOwner(ctx, leader, 'important', `${leaderName(ctx, leader)}'s crew spotted a drone over ${world(content).node(node).name}.`, node);
    }
  }
  if (first && state.reports.length === before && drone.owner === state.playerId) {
    pushFeed(state, 'routine', `Drone over ${world(content).node(node).name}: no outside crews in the streets.`, node, drone.network);
  }
}

