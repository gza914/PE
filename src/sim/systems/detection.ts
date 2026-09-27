/**
 * Resolves visibility: halcón rolls queued by movement, stationary crews in
 * watched spots, patrols, and drones. Every sighting becomes a Report for the
 * observing network. GDD: "Visibility and intelligence".
 */
import { isNight } from '../clock';
import { newId, pushFeed, type SimContext } from '../context';
import { groupOf, kmFromRoadStart, sortedCrewIds } from '../crews';
import { crewNetwork, watchersOf } from '../network';
import { chance, randRange } from '../rng';
import { detectionChance, signature, VEHICLE_TYPES } from '../signature';
import type { Confidence, CrewState, DroneReaction, Id, NetworkId, ReportSource } from '../state';
import { world } from '../world';
import { leaderName, notifyOwner, relocateOffRoad } from './movement';

export function runDetection(ctx: SimContext): void {
  for (const roll of ctx.pendingRolls) {
    const group = roll.crews.map((id) => ctx.state.crews[id]).filter((c): c is CrewState => !!c);
    if (group.length) rollNode(ctx, group, roll.node, roll.roadType ? ctx.content.tuning.roads[roll.roadType].visibility : ctx.content.tuning.detection.stationaryVisibility);
  }
  ctx.pendingRolls = [];
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

/** Every hostile watcher of `node` rolls once against the group. */
function rollNode(ctx: SimContext, group: CrewState[], node: Id, visibility: number): void {
  const { state, content } = ctx;
  const own = crewNetwork(state, group[0]!);
  const sig = signature(state, content, group, {
    visibility,
    night: isNight(state.hour, content.tuning),
    calentura: regionCalentura(ctx, node),
  });
  for (const w of watchersOf(state, content, node)) {
    if (w.network === own) continue;
    if (chance(state.rng, detectionChance(sig, w.coverage, content.tuning))) {
      report(ctx, w.network, group, 'halcon', 'estimated', node);
    }
  }
}

/** Crews sitting in (or near) a hostile-watched node are rolled for periodically. */
function rollStationary(ctx: SimContext): void {
  const { state, content } = ctx;
  const { tuning } = content;
  for (const crew of groupLeaders(ctx)) {
    if (ctx.moved.has(crew.id) || state.hour < crew.transit.nextStationaryRoll) continue;
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

function report(ctx: SimContext, network: NetworkId, group: CrewState[], source: ReportSource, confidence: Confidence, node: Id | null): void {
  const { state, content } = ctx;
  const { tuning } = content;
  const fade = tuning.detection.lastSeenFadeHours;
  const err = tuning.detection.halconMenEstimateError;
  let fresh = false;
  let men = 0;
  let vehicles = 0;
  for (const crew of group) {
    const existing = state.reports.find((r) => r.network === network && r.crew === crew.id && r.hour === state.hour && r.source === source);
    if (existing) continue;
    const seenRecently = state.reports.some((r) => r.network === network && r.crew === crew.id && state.hour - r.hour <= fade);
    if (!seenRecently) fresh = true;
    const estimate = confidence === 'estimated' ? Math.max(1, Math.round(crew.men * (1 + randRange(state.rng, -err, err)))) : crew.men;
    const v: Partial<Record<(typeof VEHICLE_TYPES)[number], number>> = {};
    for (const t of VEHICLE_TYPES) if (crew.vehicles[t] > 0) v[t] = crew.vehicles[t];
    state.reports.push({
      id: newId(state, 'rep'),
      network,
      crew: crew.id,
      owner: crew.owner,
      men: estimate,
      vehicles: v,
      where: structuredClone(crew.location),
      roadType: crew.location.kind === 'road' ? world(content).road(crew.location.road).type : null,
      hour: state.hour,
      confidence,
      source,
      planted: false,
    });
    men += estimate;
    vehicles += Object.values(v).reduce((a, b) => a + b, 0);
  }
  // Repeat sightings go to the intel ledger only; the feed flags new contacts.
  if (men === 0 || !fresh) return;
  const owner = state.characters[group[0]!.owner];
  const whose = owner ? `${owner.alias ?? owner.name}'s people` : 'unknown crew';
  const loc = group[0]!.location;
  const w = world(content);
  const where =
    loc.kind === 'node'
      ? `in ${w.node(loc.node).name}`
      : `on ${roadLabel(ctx, loc.road)}, heading for ${w.node(loc.to).name}`;
  const by = { halcon: `Halcones${node ? ` at ${w.node(node).name}` : ''}`, patrol: 'Patrol', drone: 'Drone', rumor: 'Rumor' }[source];
  const approx = confidence === 'estimated' ? '~' : '';
  pushFeed(state, 'critical', `${by}: ${approx}${men} men in ${vehicles} vehicles, ${whose}, ${where}.`, loc.kind === 'node' ? loc.node : loc.to, network);
}

function prune(ctx: SimContext): void {
  const { state, content } = ctx;
  const keep = content.tuning.detection.reportRetentionHours;
  state.reports = state.reports.filter((r) => state.hour - r.hour <= keep);
  state.drones = state.drones.filter((d) => state.hour < d.until);
}
