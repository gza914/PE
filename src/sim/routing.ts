/**
 * Route planning: Fastest, Balanced, and Safest routes between nodes, plus
 * custom waypoints. Risk is estimated from what the planning network knows
 * (GDD "Route planning is the key interaction"), so bad intel gives a bad
 * estimate. Movement later rolls against the true coverage.
 */
import type { Content } from '../data/content';
import { isNight } from './clock';
import { estimatedWatchersOf, watchersOf, type Watcher } from './network';
import { allowedRoadTypes, detectionChance, groupSpeedKmh, signature } from './signature';
import type { CrewLocation, CrewState, GameState, Id, NetworkId, PathStep, RoutePreference } from './state';
import { world } from './world';

export interface RouteRequest {
  /** The group that will travel together (a crew and its escorts). */
  crews: readonly CrewState[];
  from: CrewLocation;
  destination: Id;
  waypoints?: readonly Id[];
  preference: RoutePreference;
  departHour: number;
  /** Network whose knowledge drives the risk estimate. */
  viewer: NetworkId;
  avoidRoads?: readonly Id[];
  /** Nodes the route may end at but not pass through (e.g. rival garrisons). */
  noPassThrough?: readonly Id[];
  /** Use true coverage instead of the viewer's estimate (tests, debug). */
  omniscient?: boolean;
}

export interface Route {
  path: PathStep[];
  km: number;
  hours: number;
  /** Sum of per-node detection chances. */
  expectedDetections: number;
  /** Chance of being seen at least once. */
  detectionRisk: number;
  arrivalHour: number;
}

interface Label {
  cost: number;
  hours: number;
  km: number;
  expected: number;
  logNone: number;
  /** node is null for a seed step that starts on a road. */
  prev: { node: Id | null; step: PathStep } | null;
}

function riskWeight(pref: RoutePreference, content: Content): number {
  const r = content.tuning.routing;
  return pref === 'fastest' ? 0 : pref === 'balanced' ? r.balancedRiskWeightHours : r.safestRiskWeightHours;
}

interface LegContext {
  state: GameState;
  content: Content;
  req: RouteRequest;
  weight: number;
}

/** Detection chance for a group passing a node, as the viewer estimates it. */
function nodeRisk(ctx: LegContext, node: Id, visibility: number, hour: number): number[] {
  const { state, content, req } = ctx;
  const watchers: Watcher[] = req.omniscient
    ? watchersOf(state, content, node)
    : estimatedWatchersOf(state, content, node, req.viewer);
  const region = world(content).node(node).region;
  const sig = signature(state, content, req.crews, {
    visibility,
    night: isNight(Math.round(hour), content.tuning),
    calentura: state.regions[region]?.calentura ?? 0,
  });
  return watchers.filter((w) => w.network !== req.viewer).map((w) => detectionChance(sig, w.coverage, content.tuning));
}

function withRisks(label: Label, risks: number[], weight: number): Label {
  let { expected, logNone } = label;
  for (const p of risks) {
    expected += p;
    logNone += Math.log(1 - Math.min(p, 0.999999));
  }
  return { ...label, expected, logNone, cost: label.hours + weight * expected };
}

/**
 * Dijkstra from a location to every node. `tripStart` adds the departure roll
 * at a start node.
 */
function search(ctx: LegContext, from: CrewLocation, startHour: number, tripStart: boolean): Map<Id, Label> {
  const { content, req, weight } = ctx;
  const { tuning } = content;
  const w = world(content);
  const allowed = allowedRoadTypes(req.crews, tuning);
  const avoid = new Set(req.avoidRoads ?? []);
  const blocked = new Set(req.noPassThrough ?? []);
  const startNode = from.kind === 'node' ? from.node : null;
  const labels = new Map<Id, Label>();
  const open = new Map<Id, Label>();

  const edge = (at: Id | null, label: Label, roadId: Id, to: Id, km: number) => {
    const road = w.road(roadId);
    const speed = groupSpeedKmh(req.crews, road.type, tuning);
    if (speed <= 0) return;
    const hours = label.hours + km / speed;
    let next: Label = { ...label, hours, km: label.km + km, prev: { node: at, step: { road: roadId, to } } };
    const vis = tuning.roads[road.type].visibility;
    const risks = [to, ...road.passesNear].flatMap((n) => nodeRisk(ctx, n, vis, startHour + hours));
    next = withRisks(next, risks, weight);
    const best = labels.get(to) ?? open.get(to);
    if (!best || next.cost < best.cost - 1e-9) open.set(to, next);
  };

  const zero: Label = { cost: 0, hours: 0, km: 0, expected: 0, logNone: 0, prev: null };
  if (from.kind === 'node') {
    let start = zero;
    if (tripStart) {
      // Leaving a watched node: rolled once, on whichever road the group takes.
      const vis = Math.max(...[...allowed].map((t) => tuning.roads[t].visibility));
      start = withRisks(zero, nodeRisk(ctx, from.node, vis, startHour), weight);
    }
    open.set(from.node, start);
  } else {
    const road = w.road(from.road);
    const remaining = road.lengthKm - from.progressKm;
    edge(null, zero, road.id, from.to, remaining);
    edge(null, zero, road.id, from.from, from.progressKm);
  }

  while (open.size) {
    let bestId: Id | null = null;
    let best: Label | null = null;
    for (const [id, l] of open) {
      if (!best || l.cost < best.cost || (l.cost === best.cost && id < bestId!)) {
        best = l;
        bestId = id;
      }
    }
    open.delete(bestId!);
    labels.set(bestId!, best!);
    if (blocked.has(bestId!) && bestId !== startNode) continue;
    for (const nb of w.neighbors(bestId!)) {
      if (labels.has(nb.other) || avoid.has(nb.road.id) || !allowed.has(nb.road.type)) continue;
      edge(bestId!, best!, nb.road.id, nb.other, nb.road.lengthKm);
    }
  }
  return labels;
}

function extract(labels: Map<Id, Label>, to: Id): PathStep[] | null {
  const end = labels.get(to);
  if (!end) return null;
  const steps: PathStep[] = [];
  let cur: Label | undefined = end;
  while (cur?.prev) {
    steps.push(cur.prev.step);
    if (cur.prev.node === null) break;
    cur = labels.get(cur.prev.node);
  }
  return steps.reverse();
}

export function planRoute(state: GameState, content: Content, req: RouteRequest): Route | null {
  const ctx: LegContext = { state, content, req, weight: riskWeight(req.preference, content) };
  const stops = [...(req.waypoints ?? []), req.destination];
  let from: CrewLocation = req.from;
  let hour = req.departHour;
  const total: Route = { path: [], km: 0, hours: 0, expectedDetections: 0, detectionRisk: 0, arrivalHour: hour };
  let logNone = 0;

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    if (from.kind === 'node' && from.node === stop) continue;
    const labels = search(ctx, from, hour, i === 0);
    const end = labels.get(stop);
    const steps = extract(labels, stop);
    if (!end || !steps) return null;
    total.path.push(...steps);
    total.km += end.km;
    total.hours += end.hours;
    total.expectedDetections += end.expected;
    logNone += end.logNone;
    hour += end.hours;
    from = { kind: 'node', node: stop };
  }
  total.detectionRisk = 1 - Math.exp(logNone);
  total.arrivalHour = req.departHour + total.hours;
  return total;
}

/** All three preferences, for the route planner UI. */
export function planOptions(
  state: GameState,
  content: Content,
  req: Omit<RouteRequest, 'preference'>,
): Record<RoutePreference, Route | null> {
  return {
    fastest: planRoute(state, content, { ...req, preference: 'fastest' }),
    balanced: planRoute(state, content, { ...req, preference: 'balanced' }),
    safest: planRoute(state, content, { ...req, preference: 'safest' }),
  };
}

/** Nearest node (by travel time) satisfying a predicate, e.g. a friendly plaza for Retreat. */
export function nearestNode(
  state: GameState,
  content: Content,
  req: Omit<RouteRequest, 'preference' | 'destination' | 'waypoints'>,
  accept: (node: Id) => boolean,
): Id | null {
  const ctx: LegContext = { state, content, req: { ...req, preference: 'fastest', destination: '' }, weight: 0 };
  const labels = search(ctx, req.from, req.departHour, false);
  let best: Id | null = null;
  let bestHours = Infinity;
  for (const [id, l] of labels) {
    if (accept(id) && (l.hours < bestHours || (l.hours === bestHours && id < best!))) {
      best = id;
      bestHours = l.hours;
    }
  }
  return best;
}

/** Estimated travel hours from a location to every reachable node, in one search. */
export function travelHours(
  state: GameState,
  content: Content,
  req: Omit<RouteRequest, 'destination' | 'waypoints'>,
): Map<Id, number> {
  const ctx: LegContext = { state, content, req: { ...req, destination: '' }, weight: riskWeight(req.preference, content) };
  const out = new Map<Id, number>();
  for (const [id, l] of search(ctx, req.from, req.departHour, true)) out.set(id, l.hours);
  return out;
}
