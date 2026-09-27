/**
 * Moves crews along their planned paths one hour at a time, applying road
 * speed, vehicle limits, brecha breakdowns, sync-arrival departure times,
 * escorts, and road stations (ambush, patrol). Rolls detection at every
 * watched node a group passes. Finds the fights movement causes (ambushes,
 * road clashes, garrisons intercepting spotted groups, raids arriving) and
 * hands them to the combat system. GDD: "Units and logistics", "Combat".
 */
import { isNight } from '../clock';
import type { Engagement, SimContext } from '../context';
import { groupOf, kmFromRoadStart, sortedCrewIds } from '../crews';
import { crewNetwork, ownedBy } from '../network';
import { leaderName, notifyOwner, relocateOffRoad } from '../orders';
import { groupPower, reportedPower, wantsToAttack } from '../power';
import { chance } from '../rng';
import { planRoute } from '../routing';
import { allowedRoadTypes, groupSpeedKmh } from '../signature';
import type { CrewLocation, CrewOrder, CrewState, Id, PathStep } from '../state';
import { otherEnd, world } from '../world';
import { rollNode } from './detection';

const EPS = 1e-9;

/** Distance swept along one road this hour, in the road's own frame. */
interface Sweep {
  road: Id;
  /** Start and end, km from the road's `from` node. */
  a: number;
  b: number;
  /** Direction of travel, as crew-frame ends. */
  from: Id;
  to: Id;
  /** Remaining path when this sweep began (current step first), for rewinding. */
  pathAfter: PathStep[] | null;
}

interface MoveRun {
  ctx: SimContext;
  sweeps: Map<Id, Sweep[]>;
  orderBefore: Map<Id, CrewOrder>;
  /** Groups stopped by a fight this hour. */
  stopped: Set<Id>;
}

export function runMovement(ctx: SimContext): void {
  const { state } = ctx;
  const run: MoveRun = { ctx, sweeps: new Map(), orderBefore: new Map(), stopped: new Set() };
  const moved = new Set<string>();
  for (const id of sortedCrewIds(state)) {
    const crew = state.crews[id];
    if (!crew || crew.order.type === 'escort' || crew.battle !== null) continue;
    const group = groupOf(state, crew);
    applyShift(ctx, crew, group);
    run.orderBefore.set(crew.id, structuredClone(crew.order));
    const didMove = stepCrew(run, crew, group);
    for (const c of group) {
      if (didMove) {
        moved.add(c.id);
        c.fatigue = Math.min(100, c.fatigue + ctx.content.tuning.movement.fatiguePerTravelHour);
      } else if (c.order.type === 'garrison' || c.order.type === 'lie_low' || (c.order.type === 'escort' && crew.order.type === 'garrison')) {
        c.fatigue = Math.max(0, c.fatigue - ctx.content.tuning.movement.fatigueRecoveryPerHour);
      }
    }
  }
  findRoadContacts(run);
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

function stepCrew(run: MoveRun, crew: CrewState, group: CrewState[]): boolean {
  const { ctx } = run;
  const order = crew.order;
  switch (order.type) {
    case 'move':
    case 'retreat':
    case 'raid':
      if (order.type === 'move' && order.departAt !== null && ctx.state.hour < order.departAt) return false;
      return followPath(run, crew, group, order.path);
    case 'reinforce': {
      const battle = ctx.state.battles[order.battle];
      if (!battle || battle.endedAt !== null) {
        crew.order = { type: 'idle' };
        return false;
      }
      if (order.path.length) return followPath(run, crew, group, order.path);
      // Last leg of a road battle: drive out to the fighting.
      const w = battle.where;
      if (w.kind === 'road') return approach(run, crew, group, w.road, kmFromRoadStart(ctx.content, w), null);
      return false;
    }
    case 'ambush':
    case 'patrol':
      return approach(run, crew, group, order.road, order.atKm, order);
    default:
      return false;
  }
}

/** Leaves a node onto a road. Returns false if the group broke down. */
function enterRoad(run: MoveRun, crew: CrewState, group: CrewState[], roadId: Id, fromNode: Id): boolean {
  const { ctx } = run;
  const { state, content } = ctx;
  const { tuning } = content;
  const road = world(content).road(roadId);
  if (crew.transit.lastRolledNode !== fromNode) rollNode(ctx, group, fromNode, tuning.roads[road.type].visibility);
  crew.transit.lastRolledNode = null;
  crew.transit.rolled = [];
  crew.transit.spotted = null;
  // Leaving Culiacán gives up the crew's colonia.
  for (const g of group) g.colonia = null;
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
 * (measured from the crew's `from`). Rolls approach and pass-near detection
 * and records the sweep. Returns hours used.
 */
function drive(run: MoveRun, crew: CrewState, group: CrewState[], targetKm: number, budgetHours: number, pathAfter: PathStep[] | null): number {
  const { ctx } = run;
  const { content } = ctx;
  const loc = crew.location;
  if (loc.kind !== 'road') return 0;
  const road = world(content).road(loc.road);
  const speed = groupSpeedKmh(group, road.type, content.tuning);
  if (speed <= 0) return budgetHours;
  const p0 = loc.progressKm;
  const p1 = Math.min(targetKm, p0 + speed * budgetHours);
  const t = crew.transit;
  const vis = content.tuning.roads[road.type].visibility;
  const approachAt = Math.max(0, road.lengthKm - content.tuning.map.halconRoadCoverageKm);
  if (p0 <= approachAt + EPS && p1 >= approachAt - EPS && p1 > p0 && !t.rolled.includes(loc.to)) {
    t.rolled.push(loc.to);
    t.lastRolledNode = loc.to;
    t.spotted = { node: loc.to, by: rollNode(ctx, group, loc.to, vis) };
  }
  const mid = road.lengthKm / 2;
  if (p0 <= mid && p1 > mid) {
    for (const near of road.passesNear) {
      if (t.rolled.includes(near)) continue;
      t.rolled.push(near);
      rollNode(ctx, group, near, vis);
    }
  }
  loc.progressKm = p1;
  const frame = (p: number) => (loc.from === road.from ? p : road.lengthKm - p);
  if (p1 > p0) {
    const list = run.sweeps.get(crew.id) ?? [];
    list.push({ road: road.id, a: frame(p0), b: frame(p1), from: loc.from, to: loc.to, pathAfter: pathAfter ? structuredClone(pathAfter) : null });
    run.sweeps.set(crew.id, list);
  }
  return (p1 - p0) / speed;
}

function followPath(run: MoveRun, crew: CrewState, group: CrewState[], path: PathStep[]): boolean {
  const { ctx } = run;
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
      if (!enterRoad(run, crew, group, road.id, loc.node)) return moved;
    } else if (loc.to !== step.to) {
      crew.location = { ...loc, from: loc.to, to: loc.from, progressKm: road.lengthKm - loc.progressKm };
      t.rolled = [];
      t.spotted = null;
    }
    budget -= drive(run, crew, group, road.lengthKm, budget, path);
    moved = true;
    const now = crew.location;
    if (now.kind === 'road' && now.progressKm >= road.lengthKm - EPS) {
      crew.location = { kind: 'node', node: step.to };
      path.shift();
      if (path.length && intercepted(run, crew, group, step.to)) return moved;
    }
  }
  if (!path.length) arrive(run, crew, group);
  return moved;
}

/**
 * A group reaching a node whose owners spotted it coming may be stopped by the
 * garrison, if the garrison judges itself strong enough from its reports.
 */
function intercepted(run: MoveRun, crew: CrewState, group: CrewState[], node: Id): boolean {
  const { ctx } = run;
  const { state, content } = ctx;
  const spotted = crew.transit.spotted;
  crew.transit.spotted = null;
  // Culiacán is fought for colonia by colonia, not at the city limits.
  if (!spotted || spotted.node !== node || node === content.culiacan.parentNode) return false;
  for (const net of spotted.by) {
    const garrison = crewsAt(ctx, node).filter((c) => crewNetwork(state, c) === net && c.order.type !== 'lie_low');
    if (!garrison.length) continue;
    const defenders = garrison.flatMap((c) => groupOf(state, c));
    if (!wantsToAttack(state, content, defenders, reportedPower(state, content, net, group))) continue;
    ctx.engagements.push({ type: 'raid', attackers: group.map((c) => c.id), defenders: defenders.map((c) => c.id), where: { kind: 'node', node }, capture: false });
    run.stopped.add(crew.id);
    return true;
  }
  return false;
}

/** Group leaders at a node that are free to fight. */
function crewsAt(ctx: SimContext, node: Id): CrewState[] {
  return sortedCrewIds(ctx.state)
    .map((id) => ctx.state.crews[id]!)
    .filter((c) => c.location.kind === 'node' && c.location.node === node && c.battle === null && c.order.type !== 'escort');
}

function arrive(run: MoveRun, crew: CrewState, group: CrewState[]): void {
  const { ctx } = run;
  const { state, content } = ctx;
  const loc = crew.location;
  if (loc.kind !== 'node') return;
  const network = crewNetwork(state, crew);
  crew.transit.lastRolledNode = null;
  crew.transit.nextStationaryRoll = state.hour + content.tuning.detection.stationaryRollIntervalHours;
  const order = crew.order;
  if (order.type === 'raid' && order.target === loc.node) {
    const plaza = state.nodes[loc.node]!;
    const defenders = crewsAt(ctx, loc.node)
      .filter((c) => crewNetwork(state, c) !== network && c.order.type !== 'lie_low')
      .flatMap((c) => groupOf(state, c));
    const type = defenders.length && plaza.fortification >= content.tuning.combat.siegeMinFortification ? 'siege' : 'raid';
    ctx.engagements.push({ type, attackers: group.map((c) => c.id), defenders: defenders.map((c) => c.id), where: { kind: 'node', node: loc.node }, capture: true });
    return;
  }
  if (order.type === 'reinforce') return;
  if (intercepted(run, crew, group, loc.node)) {
    crew.order = { type: 'idle' };
    return;
  }
  crew.order = ownedBy(state, loc.node, network) ? { type: 'garrison' } : { type: 'idle' };
  notifyOwner(ctx, crew, 'routine', `${leaderName(ctx, crew)}'s crew reached ${world(content).node(loc.node).name}.`, loc.node);
}

/**
 * Moves onto a road and holds a point on it. `atKm` is from the road's own
 * `from` node; null means the midpoint. With a station order the point is
 * saved on arrival; without one (reinforcing) the crew just drives there.
 */
function approach(
  run: MoveRun,
  crew: CrewState,
  group: CrewState[],
  roadId: Id,
  atKm: number | null,
  order: Extract<CrewOrder, { type: 'ambush' | 'patrol' }> | null,
): boolean {
  const { ctx } = run;
  const { content } = ctx;
  const road = world(content).road(roadId);
  const target = atKm ?? road.lengthKm / 2;
  let loc = crew.location;
  if (loc.kind === 'node') {
    if (loc.node !== road.from && loc.node !== road.to) {
      crew.order = { type: 'idle' };
      return false;
    }
    if (!enterRoad(run, crew, group, road.id, loc.node)) return false;
    loc = crew.location;
  }
  if (loc.kind !== 'road' || loc.road !== road.id) {
    crew.order = { type: 'idle' };
    return false;
  }
  if (Math.abs(kmFromRoadStart(content, loc) - target) < EPS) {
    if (order) order.atKm = target;
    return false;
  }
  // Face the target, then drive to it.
  const targetInFrame = loc.from === road.from ? target : road.lengthKm - target;
  if (targetInFrame < loc.progressKm) {
    crew.location = { ...loc, from: loc.to, to: loc.from, progressKm: road.lengthKm - loc.progressKm };
    crew.transit.rolled = [];
  }
  const now = crew.location as Extract<CrewLocation, { kind: 'road' }>;
  drive(run, crew, group, now.from === road.from ? target : road.lengthKm - target, 1, null);
  if (Math.abs(kmFromRoadStart(content, now) - target) < EPS && order) {
    order.atKm = target;
    crew.transit.nextStationaryRoll = ctx.state.hour + content.tuning.detection.stationaryRollIntervalHours;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Road contacts: ambushes and clashes found from this hour's sweeps
// ---------------------------------------------------------------------------

interface Contact {
  dist: number;
  at: number;
  other: CrewState;
  otherSweep: Sweep | null;
}

function findRoadContacts(run: MoveRun): void {
  const { ctx } = run;
  const { state, content } = ctx;
  const engaged = new Set<Id>(run.stopped);
  const leaders = sortedCrewIds(state)
    .map((id) => state.crews[id]!)
    .filter((c) => c.order.type !== 'escort' && c.battle === null);
  const stationary = leaders.filter((c) => c.location.kind === 'road' && !run.sweeps.has(c.id));
  const movers = leaders.filter((c) => run.sweeps.has(c.id));

  for (const g of movers) {
    if (engaged.has(g.id)) continue;
    const gNet = crewNetwork(state, g);
    for (const s of run.sweeps.get(g.id)!) {
      const lo = Math.min(s.a, s.b) - EPS;
      const hi = Math.max(s.a, s.b) + EPS;
      const contacts: Contact[] = [];
      for (const h of stationary) {
        const loc = h.location;
        if (engaged.has(h.id) || loc.kind !== 'road' || loc.road !== s.road || crewNetwork(state, h) === gNet) continue;
        const p = kmFromRoadStart(content, loc);
        if (p >= lo && p <= hi) contacts.push({ dist: Math.abs(p - s.a), at: p, other: h, otherSweep: null });
      }
      for (const m of movers) {
        if (m.id === g.id || engaged.has(m.id) || crewNetwork(state, m) === gNet) continue;
        for (const ms of run.sweeps.get(m.id)!) {
          if (ms.road !== s.road || Math.sign(ms.b - ms.a) === Math.sign(s.b - s.a)) continue;
          const olo = Math.max(lo, Math.min(ms.a, ms.b));
          const ohi = Math.min(hi, Math.max(ms.a, ms.b));
          if (olo > ohi) continue;
          const at = (olo + ohi) / 2;
          contacts.push({ dist: Math.abs(at - s.a), at, other: m, otherSweep: ms });
        }
      }
      contacts.sort((x, y) => x.dist - y.dist || (x.other.id < y.other.id ? -1 : 1));
      const hit = contacts.find((c) => resolveContact(run, g, s, c));
      if (hit) {
        engaged.add(g.id);
        engaged.add(hit.other.id);
        break;
      }
    }
  }
}

/** Decides whether a contact becomes a fight; if so, rewinds both groups to it and queues the engagement. */
function resolveContact(run: MoveRun, g: CrewState, s: Sweep, c: Contact): boolean {
  const { ctx } = run;
  const { state, content } = ctx;
  const gGroup = groupOf(state, g);
  const hGroup = groupOf(state, c.other);
  let engagement: Engagement['type'] | null = null;
  let attackers = hGroup;
  let defenders = gGroup;
  if (c.other.order.type === 'ambush' && c.other.order.atKm !== null) {
    const alert = Math.max(...gGroup.map((x) => x.alertness)) / 100;
    engagement = chance(state.rng, alert * content.tuning.combat.ambushSpotAlertnessFactor) ? null : 'ambush';
  }
  if (!engagement) {
    // At close range both sides see each other plainly.
    const gWants = wantsToAttack(state, content, gGroup, groupPower(state, content, hGroup));
    const hWants = wantsToAttack(state, content, hGroup, groupPower(state, content, gGroup));
    if (!gWants && !hWants) return false;
    engagement = 'road_clash';
    if (gWants && !hWants) [attackers, defenders] = [gGroup, hGroup];
  }
  rewind(run, g, s, c.at);
  if (c.otherSweep) rewind(run, c.other, c.otherSweep, c.at);
  const road = world(content).road(s.road);
  const where: CrewLocation = { kind: 'road', road: road.id, from: road.from, to: road.to, progressKm: c.at };
  ctx.engagements.push({ type: engagement, attackers: attackers.map((x) => x.id), defenders: defenders.map((x) => x.id), where, capture: false });
  return true;
}

/** Puts a group back at a point it passed this hour, restoring its order. */
function rewind(run: MoveRun, crew: CrewState, s: Sweep, atKm: number): void {
  const road = world(run.ctx.content).road(s.road);
  const progressKm = s.from === road.from ? atKm : road.lengthKm - atKm;
  crew.location = { kind: 'road', road: road.id, from: s.from, to: s.to, progressKm };
  const before = run.orderBefore.get(crew.id);
  if (before) {
    const order = structuredClone(before);
    if ('path' in order && s.pathAfter) order.path = structuredClone(s.pathAfter);
    crew.order = order;
  }
}
