/**
 * Moves crews along their planned paths one hour at a time, applying road
 * speed, vehicle limits, brecha breakdowns, sync-arrival departure times,
 * escorts, and road stations (ambush, patrol). Queues detection rolls for
 * every watched node a group passes; the detection system resolves them.
 * GDD: "Units and logistics".
 */
import { isNight } from '../clock';
import { pushFeed, type SimContext } from '../context';
import { groupOf, kmFromRoadStart, nearerEnd, sortedCrewIds } from '../crews';
import { crewNetwork, networkOf, ownedBy } from '../network';
import { chance } from '../rng';
import { planRoute } from '../routing';
import { allowedRoadTypes, groupSpeedKmh } from '../signature';
import type { CrewState, PathStep } from '../state';
import { otherEnd, world } from '../world';

const EPS = 1e-9;

export function runMovement(ctx: SimContext): void {
  const { state } = ctx;
  const moved = new Set<string>();
  for (const id of sortedCrewIds(state)) {
    const crew = state.crews[id];
    if (!crew || crew.order.type === 'escort') continue;
    const group = groupOf(state, crew);
    applyShift(ctx, crew, group);
    const didMove = stepCrew(ctx, crew, group);
    for (const c of group) {
      if (didMove) {
        moved.add(c.id);
        c.fatigue = Math.min(100, c.fatigue + ctx.content.tuning.movement.fatiguePerTravelHour);
      } else if (c.order.type === 'garrison' || c.order.type === 'lie_low' || (c.order.type === 'escort' && crew.order.type === 'garrison')) {
        c.fatigue = Math.max(0, c.fatigue - ctx.content.tuning.movement.fatigueRecoveryPerHour);
      }
    }
  }
  // Escorts ride with their crew; an escort whose crew is gone stands down.
  for (const id of sortedCrewIds(state)) {
    const c = state.crews[id]!;
    if (c.order.type !== 'escort') continue;
    const target = state.crews[c.order.crew];
    if (!target || target.order.type === 'escort') {
      c.order = { type: 'idle' };
      continue;
    }
    c.location = structuredClone(target.location);
    c.transit = structuredClone(target.transit);
  }
  ctx.moved = moved;
}

/** A Calculador leader who spotted a drone shifts position once it has gone. */
function applyShift(ctx: SimContext, crew: CrewState, group: CrewState[]): void {
  const { state, content } = ctx;
  const t = crew.transit;
  if (t.shiftAt === null || state.hour < t.shiftAt) return;
  const avoid = t.shiftAvoidRoad;
  t.shiftAt = null;
  t.shiftAvoidRoad = null;
  const order = crew.order;
  if (order.type === 'move') {
    const route = planRoute(state, content, {
      crews: group,
      from: crew.location,
      destination: order.destination,
      preference: order.preference,
      departHour: state.hour,
      viewer: crewNetwork(state, crew),
      avoidRoads: avoid ? [avoid] : [],
    });
    if (route) {
      order.path = route.path;
      return;
    }
  }
  if (crew.location.kind === 'road') relocateOffRoad(ctx, crew);
}

/** Order a crew on a road to the nearer end, off the road. */
export function relocateOffRoad(ctx: SimContext, crew: CrewState): void {
  if (crew.location.kind !== 'road') return;
  const to = nearerEnd(ctx.content, crew.location);
  crew.order = {
    type: 'move',
    destination: to,
    preference: 'fastest',
    waypoints: [],
    path: [{ road: crew.location.road, to }],
    departAt: null,
    arriveAt: null,
  };
}

function stepCrew(ctx: SimContext, crew: CrewState, group: CrewState[]): boolean {
  const order = crew.order;
  switch (order.type) {
    case 'move':
    case 'retreat':
    case 'raid':
    case 'reinforce':
      if (order.type === 'move' && order.departAt !== null && ctx.state.hour < order.departAt) return false;
      return followPath(ctx, crew, group, order.path);
    case 'ambush':
    case 'patrol':
      return station(ctx, crew, group, order);
    default:
      return false;
  }
}

function queueRoll(ctx: SimContext, group: CrewState[], node: string, roadType: 'highway' | 'paved' | 'brecha') {
  ctx.pendingRolls.push({ crews: group.map((c) => c.id), node, roadType });
}

/** Leaves a node onto a road. Returns false if the group broke down. */
function enterRoad(ctx: SimContext, crew: CrewState, group: CrewState[], roadId: string, fromNode: string): boolean {
  const { state, content } = ctx;
  const { tuning } = content;
  const road = world(content).road(roadId);
  if (crew.transit.lastRolledNode !== fromNode) queueRoll(ctx, group, fromNode, road.type);
  crew.transit.lastRolledNode = null;
  crew.transit.rolled = [];
  crew.location = { kind: 'road', road: road.id, from: fromNode, to: otherEnd(road, fromNode), progressKm: 0 };
  const breakdown = tuning.roads[road.type].breakdownChancePerSegment ?? 0;
  if (breakdown > 0) {
    const p = breakdown * (isNight(state.hour, tuning) ? tuning.clock.nightBrechaBreakdownMultiplier : 1);
    if (chance(state.rng, p)) {
      crew.transit.waitUntil = state.hour + tuning.movement.breakdownDelayHours;
      notifyOwner(ctx, crew, 'routine', `A vehicle broke down on the brecha out of ${world(content).node(fromNode).name}. Delayed ${tuning.movement.breakdownDelayHours}h.`, fromNode);
      return false;
    }
  }
  return true;
}

/**
 * Drives up to `budgetHours` along the current road toward `targetKm`
 * (measured from the crew's `from`). Queues approach and pass-near rolls.
 * Returns hours used.
 */
function drive(ctx: SimContext, crew: CrewState, group: CrewState[], targetKm: number, budgetHours: number): number {
  const { content } = ctx;
  const loc = crew.location;
  if (loc.kind !== 'road') return 0;
  const road = world(content).road(loc.road);
  const speed = groupSpeedKmh(group, road.type, content.tuning);
  if (speed <= 0) return budgetHours;
  const p0 = loc.progressKm;
  const p1 = Math.min(targetKm, p0 + speed * budgetHours);
  const t = crew.transit;
  const approach = Math.max(0, road.lengthKm - content.tuning.map.halconRoadCoverageKm);
  if (p0 <= approach + EPS && p1 >= approach - EPS && p1 > p0 && !t.rolled.includes(loc.to)) {
    t.rolled.push(loc.to);
    t.lastRolledNode = loc.to;
    queueRoll(ctx, group, loc.to, road.type);
  }
  const mid = road.lengthKm / 2;
  if (p0 <= mid && p1 > mid) {
    for (const near of road.passesNear) {
      if (t.rolled.includes(near)) continue;
      t.rolled.push(near);
      queueRoll(ctx, group, near, road.type);
    }
  }
  loc.progressKm = p1;
  return (p1 - p0) / speed;
}

function followPath(ctx: SimContext, crew: CrewState, group: CrewState[], path: PathStep[]): boolean {
  const { state, content } = ctx;
  const w = world(content);
  const t = crew.transit;
  if (t.waitUntil !== null) {
    if (state.hour < t.waitUntil) return false;
    t.waitUntil = null;
  }
  const allowed = allowedRoadTypes(group, content.tuning);
  let budget = 1;
  let moved = false;
  while (budget > EPS && path.length) {
    const step = path[0]!;
    const road = w.road(step.road);
    const loc = crew.location;
    if (!allowed.has(road.type) || (loc.kind === 'node' && loc.node !== road.from && loc.node !== road.to) || (loc.kind === 'road' && loc.road !== road.id)) {
      notifyOwner(ctx, crew, 'important', `${leaderName(ctx, crew)}'s crew could not follow its route and stopped.`, loc.kind === 'node' ? loc.node : null);
      crew.order = { type: 'idle' };
      return moved;
    }
    if (loc.kind === 'node') {
      if (!enterRoad(ctx, crew, group, road.id, loc.node)) return moved;
    } else if (loc.to !== step.to) {
      crew.location = { ...loc, from: loc.to, to: loc.from, progressKm: road.lengthKm - loc.progressKm };
      t.rolled = [];
    }
    budget -= drive(ctx, crew, group, road.lengthKm, budget);
    moved = true;
    const now = crew.location;
    if (now.kind === 'road' && now.progressKm >= road.lengthKm - EPS) {
      crew.location = { kind: 'node', node: step.to };
      path.shift();
    }
  }
  if (!path.length) arrive(ctx, crew);
  return moved;
}

function arrive(ctx: SimContext, crew: CrewState): void {
  const { state, content } = ctx;
  const loc = crew.location;
  if (loc.kind !== 'node') return;
  const network = crewNetwork(state, crew);
  crew.order = ownedBy(state, loc.node, network) ? { type: 'garrison' } : { type: 'idle' };
  crew.transit.lastRolledNode = null;
  crew.transit.nextStationaryRoll = state.hour + content.tuning.detection.stationaryRollIntervalHours;
  notifyOwner(ctx, crew, 'routine', `${leaderName(ctx, crew)}'s crew reached ${world(content).node(loc.node).name}.`, loc.node);
}

/** Moves onto a road and holds a point on it (ambush or patrol). */
function station(
  ctx: SimContext,
  crew: CrewState,
  group: CrewState[],
  order: Extract<CrewState['order'], { type: 'ambush' | 'patrol' }>,
): boolean {
  const { content } = ctx;
  const road = world(content).road(order.road);
  const target = order.atKm ?? road.lengthKm / 2;
  let loc = crew.location;
  if (loc.kind === 'node') {
    if (loc.node !== road.from && loc.node !== road.to) {
      crew.order = { type: 'idle' };
      return false;
    }
    if (!enterRoad(ctx, crew, group, road.id, loc.node)) return false;
    loc = crew.location;
  }
  if (loc.kind !== 'road' || loc.road !== road.id) {
    crew.order = { type: 'idle' };
    return false;
  }
  const here = kmFromRoadStart(content, loc);
  if (Math.abs(here - target) < EPS) {
    order.atKm = target;
    return false;
  }
  // Face the target, then drive to it.
  const targetInFrame = loc.from === road.from ? target : road.lengthKm - target;
  if (targetInFrame < loc.progressKm) {
    crew.location = { ...loc, from: loc.to, to: loc.from, progressKm: road.lengthKm - loc.progressKm };
    crew.transit.rolled = [];
  }
  const now = crew.location as Extract<CrewState['location'], { kind: 'road' }>;
  drive(ctx, crew, group, now.from === road.from ? target : road.lengthKm - target, 1);
  if (Math.abs(kmFromRoadStart(content, now) - target) < EPS) {
    order.atKm = target;
    crew.transit.nextStationaryRoll = ctx.state.hour + content.tuning.detection.stationaryRollIntervalHours;
  }
  return true;
}

export function leaderName(ctx: SimContext, crew: CrewState): string {
  const c = ctx.state.characters[crew.leader];
  return c ? (c.alias ?? c.name) : crew.leader;
}

/** Feed entry about one of the player's own crews. */
export function notifyOwner(ctx: SimContext, crew: CrewState, tier: 'critical' | 'important' | 'routine', text: string, node: string | null): void {
  if (crew.owner !== ctx.state.playerId) return;
  pushFeed(ctx.state, tier, text, node, networkOf(ctx.state, crew.owner));
}
