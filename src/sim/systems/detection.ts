/**
 * Resolves visibility: halcón rolls (called by movement as groups pass watched
 * nodes), stationary crews in watched spots, patrols, and drones. Every sighting becomes a Report for the
 * observing network. GDD: "Visibility and intelligence".
 */
import { isNight } from '../clock';
import { newId, pushFeed, type SimContext } from '../context';
import { groupOf, kmFromRoadStart, sortedCrewIds } from '../crews';
import { crewNetwork, watchersOf } from '../network';
import { fmtRange, sample, spreadOf, type Range } from '../estimate';
import { chance, randRange } from '../rng';
import { detectionChance, signature, VEHICLE_TYPES } from '../signature';
import type { Confidence, CrewState, DroneReaction, Id, NetworkId, ReportSource } from '../state';
import { droneOverTown } from '../intel';
import { world } from '../world';
import { leaderName, notifyOwner, relocateOffRoad } from '../orders';

export function runDetection(ctx: SimContext): void {
  observePresence(ctx);
  rollStationary(ctx);
  runPatrols(ctx);
  runDrones(ctx);
  prune(ctx);
}

function groupLeaders(ctx: SimContext): CrewState[] {
  return sortedCrewIds(ctx.state)
    .map((id) => ctx.state.crews[id]!)
    .filter((c) => c.order.type !== 'escort');
}

function regionCalentura(ctx: SimContext, node: Id): number {
  return ctx.state.regions[world(ctx.content).node(node).region]?.calentura ?? 0;
}

/** Every hostile watcher of `node` rolls once against the group. Returns the networks that saw it. */
export function rollNode(ctx: SimContext, group: CrewState[], node: Id, visibility: number): NetworkId[] {
  const { state, content } = ctx;
  const own = crewNetwork(state, group[0]!);
  const sig = signature(state, content, group, {
    visibility,
    night: isNight(state.hour, content.tuning),
    calentura: regionCalentura(ctx, node),
  });
  const seen: NetworkId[] = [];
  for (const w of watchersOf(state, content, node)) {
    if (w.network === own) continue;
    if (chance(state.rng, detectionChance(sig, w.coverage, content.tuning))) {
      report(ctx, w.network, group, 'halcon', 'estimated', node);
      seen.push(w.network);
    }
  }
  return seen;
}

/**
 * Crews in the same node see each other: every network with someone there
 * (even lying low) sees rival crews that are not lying low. This is how a
 * scout inside a rival town learns its garrison.
 */
function observePresence(ctx: SimContext): void {
  const { state, content } = ctx;
  const every = content.tuning.detection.presenceReportIntervalHours;
  const byNode = new Map<Id, CrewState[]>();
  for (const id of sortedCrewIds(state)) {
    const c = state.crews[id]!;
    if (c.location.kind !== 'node') continue;
    // Culiacán is too big to see across; contact there is by colonia.
    const key = c.location.node === content.culiacan.parentNode ? `${c.location.node}#${c.colonia ?? '-'}` : c.location.node;
    byNode.set(key, [...(byNode.get(key) ?? []), c]);
  }
  for (const key of [...byNode.keys()].sort()) {
    const here = byNode.get(key)!;
    if (key.endsWith('#-')) continue;
    const nets = [...new Set(here.map((c) => crewNetwork(state, c)))].sort();
    if (nets.length < 2) continue;
    for (const net of nets) {
      for (const c of here) {
        if (crewNetwork(state, c) === net || c.order.type === 'lie_low' || c.order.type === 'escort') continue;
        const recent = state.reports.some((r) => r.network === net && r.crew === c.id && state.hour - r.hour < every);
        if (recent) continue;
        report(ctx, net, groupOf(state, c), 'presence', 'confirmed', null);
      }
    }
  }
}

/** Crews sitting in (or near) a hostile-watched node are rolled for periodically. */
function rollStationary(ctx: SimContext): void {
  const { state, content } = ctx;
  const { tuning } = content;
  for (const crew of groupLeaders(ctx)) {
    if (ctx.moved.has(crew.id) || crew.battle !== null || state.hour < crew.transit.nextStationaryRoll) continue;
    crew.transit.nextStationaryRoll = state.hour + tuning.detection.stationaryRollIntervalHours;
    const group = groupOf(state, crew);
    const loc = crew.location;
    if (loc.kind === 'node') {
      rollNode(ctx, group, loc.node, tuning.detection.stationaryVisibility);
    } else {
      const road = world(content).road(loc.road);
      const at = kmFromRoadStart(content, loc);
      const cov = tuning.map.halconRoadCoverageKm;
      const vis = tuning.roads[road.type].visibility;
      if (at <= cov) rollNode(ctx, group, road.from, vis);
      if (road.lengthKm - at <= cov) rollNode(ctx, group, road.to, vis);
    }
  }
}

/** A patrolling crew watches its road segment every hour. */
function runPatrols(ctx: SimContext): void {
  const { state, content } = ctx;
  const { tuning } = content;
  const leaders = groupLeaders(ctx);
  for (const patrol of leaders) {
    if (patrol.order.type !== 'patrol' || patrol.order.atKm === null || patrol.location.kind !== 'road') continue;
    const road = world(content).road(patrol.location.road);
    const net = crewNetwork(state, patrol);
    for (const other of leaders) {
      if (other.location.kind !== 'road' || other.location.road !== road.id || crewNetwork(state, other) === net) continue;
      const group = groupOf(state, other);
      const sig = signature(state, content, group, {
        visibility: tuning.roads[road.type].visibility,
        night: isNight(state.hour, tuning),
        calentura: regionCalentura(ctx, road.from),
      });
      if (chance(state.rng, detectionChance(sig, tuning.detection.patrolCoverage, tuning))) {
        report(ctx, net, group, 'patrol', 'confirmed', null);
      }
    }
  }
}

function droneReaction(ctx: SimContext, crew: CrewState): DroneReaction {
  for (const t of ctx.state.characters[crew.leader]?.traits ?? []) {
    const r = ctx.content.traits.find((tr) => tr.id === t)?.droneReaction;
    if (r) return r;
  }
  return 'hold';
}

function runDrones(ctx: SimContext): void {
  const { state, content } = ctx;
  const { tuning } = content;
  for (const drone of state.drones) {
    if (state.hour >= drone.until) continue;
    if (drone.node !== null) {
      droneOverTown(ctx, drone);
      continue;
    }
    if (drone.road === null) continue;
    const road = world(content).road(drone.road);
    for (const crew of groupLeaders(ctx)) {
      if (crew.location.kind !== 'road' || crew.location.road !== road.id || crewNetwork(state, crew) === drone.network) continue;
      const group = groupOf(state, crew);
      report(ctx, drone.network, group, 'drone', 'confirmed', null);
      if (drone.rolled.includes(crew.id)) continue;
      drone.rolled.push(crew.id);
      const alertness = Math.max(...group.map((c) => c.alertness));
      if (!chance(state.rng, (alertness / 100) * tuning.detection.droneNoticeAlertnessFactor)) continue;
      const reaction = droneReaction(ctx, crew);
      const what = { relocate: 'pulling off the road', ambush: 'digging in to wait', feign: 'acting as if nothing happened', hold: 'holding position' }[reaction];
      notifyOwner(ctx, crew, 'critical', `${leaderName(ctx, crew)}'s crew spotted a drone over ${roadLabel(ctx, road.id)}: ${what}.`, null);
      switch (reaction) {
        case 'relocate':
          relocateOffRoad(ctx, crew);
          break;
        case 'ambush':
          crew.order = { type: 'ambush', road: road.id, atKm: kmFromRoadStart(content, crew.location) };
          break;
        case 'feign':
          crew.transit.shiftAt = drone.until;
          crew.transit.shiftAvoidRoad = road.id;
          break;
        case 'hold':
          crew.order = { type: 'idle' };
          break;
      }
    }
  }
}

export function roadLabel(ctx: SimContext, roadId: Id): string {
  const w = world(ctx.content);
  const road = w.road(roadId);
  return `the ${road.type} ${w.node(road.from).name}–${w.node(road.to).name}`;
}

export function report(
  ctx: SimContext,
  network: NetworkId,
  group: CrewState[],
  source: ReportSource,
  confidence: Confidence,
  node: Id | null,
  estimateFor?: (crew: CrewState) => Range,
  quiet = false,
): void {
  const { state, content } = ctx;
  const { tuning } = content;
  const fade = tuning.detection.lastSeenFadeHours;
  let fresh = false;
  let men = 0;
  let low = 0;
  let high = 0;
  let vehicles = 0;
  for (const crew of group) {
    const existing = state.reports.find((r) => r.network === network && r.crew === crew.id && r.hour === state.hour && r.source === source);
    if (existing) continue;
    const seenRecently = state.reports.some((r) => r.network === network && r.crew === crew.id && state.hour - r.hour <= fade);
    const est = estimateFor ? estimateFor(crew) : sample(state.rng, tuning, crew.men, spreadOf(tuning, source));
    if (est.men <= 0) continue;
    if (!seenRecently) fresh = true;
    const v: Partial<Record<(typeof VEHICLE_TYPES)[number], number>> = {};
    for (const t of VEHICLE_TYPES) if (crew.vehicles[t] > 0) v[t] = crew.vehicles[t];
    state.reports.push({
      id: newId(state, 'rep'),
      network,
      crew: crew.id,
      owner: crew.owner,
      men: est.men,
      low: est.low,
      high: est.high,
      vehicles: v,
      where: structuredClone(crew.location),
      roadType: crew.location.kind === 'road' ? world(content).road(crew.location.road).type : null,
      hour: state.hour,
      confidence,
      source,
      planted: false,
    });
    men += est.men;
    low += est.low;
    high += est.high;
    vehicles += Object.values(v).reduce((a, b) => a + b, 0);
  }
  // Repeat sightings go to the intel ledger only; the feed flags new contacts.
  if (men === 0 || !fresh || quiet) return;
  const owner = state.characters[group[0]!.owner];
  const whose = owner ? `${owner.alias ?? owner.name}'s people` : 'unknown crew';
  const loc = group[0]!.location;
  const w = world(content);
  const where =
    loc.kind === 'node'
      ? `in ${w.node(loc.node).name}`
      : `on ${roadLabel(ctx, loc.road)}, heading for ${w.node(loc.to).name}`;
  const by = { halcon: `Halcones${node ? ` at ${w.node(node).name}` : ''}`, patrol: 'Patrol', drone: 'Drone', presence: 'Our people in town', rumor: 'Rumor', informant: 'Informant' }[source];
  pushFeed(state, 'critical', `${by}: ${fmtRange({ men, low, high })} men in ${vehicles} vehicles, ${whose}, ${where}.`, loc.kind === 'node' ? loc.node : loc.to, network);
}

function prune(ctx: SimContext): void {
  const { state, content } = ctx;
  const keep = content.tuning.detection.reportRetentionHours;
  state.reports = state.reports.filter((r) => state.hour - r.hour <= keep);
  state.drones = state.drones.filter((d) => state.hour < d.until);
}
