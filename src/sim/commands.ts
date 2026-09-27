/**
 * Commands are the only way to change game state from outside the sim. The UI
 * and the AI both issue them; the core validates and applies them at the start
 * of the next tick. Orders name intent (go here, fastest); the sim plans the
 * path itself with the issuer's own knowledge.
 */
import type { ExtortionRate, VehicleType } from '../data/schemas';
import { newId, pushFeed, type SimContext } from './context';
import { escortsOf, groupOf, sameLocation } from './crews';
import { crewNetwork, networkOf, ownedBy } from './network';
import { newTransit } from './newGame';
import { nearestNode, planRoute } from './routing';
import { allowedRoadTypes, seats, VEHICLE_TYPES } from './signature';
import type { CrewOrder, CrewState, Id, RoutePreference } from './state';
import { world } from './world';

interface Base {
  /** Character issuing the command. */
  issuer: Id;
}

export type OrderRequest =
  | { type: 'move'; destination: Id; preference: RoutePreference; waypoints?: Id[]; arriveAt?: number | null }
  | { type: 'retreat' }
  | { type: 'garrison' }
  | { type: 'lie_low' }
  | { type: 'idle' }
  | { type: 'ambush'; road: Id }
  | { type: 'patrol'; road: Id }
  | { type: 'escort'; crew: Id };

export type Command =
  | (Base & { type: 'declare_alignment'; faction: Id | null })
  | (Base & { type: 'set_extortion_rate'; node: Id; rate: ExtortionRate })
  | (Base & { type: 'set_halcon_coverage'; node: Id; coverage: number })
  | (Base & { type: 'order_crew'; crew: Id; order: OrderRequest })
  | (Base & { type: 'split_crew'; crew: Id; men: number; vehicles: Partial<Record<VehicleType, number>>; leader?: Id })
  | (Base & { type: 'merge_crews'; crew: Id; into: Id })
  | (Base & { type: 'launch_drone'; road: Id })
  | (Base & { type: 'choose_event_option'; instance: Id; option: number });

export interface Rejection {
  command: Command;
  reason: string;
}

/** Applies one command in place. Returns a reason string if it was rejected. */
export function applyCommand(ctx: SimContext, cmd: Command): string | null {
  const { state, content } = ctx;
  const issuer = state.characters[cmd.issuer];
  if (!issuer) return `unknown issuer "${cmd.issuer}"`;
  if (issuer.status !== 'free') return `${issuer.name} is ${issuer.status}`;

  switch (cmd.type) {
    case 'declare_alignment': {
      if (cmd.faction !== null && !content.factions.some((f) => f.id === cmd.faction && f.kind === 'major'))
        return `"${cmd.faction}" is not a major faction`;
      // TODO(diplomacy): side-switch penalties once day 0 has passed.
      issuer.faction = cmd.faction;
      return null;
    }
    case 'set_extortion_rate': {
      const node = state.nodes[cmd.node];
      if (!node) return `unknown node "${cmd.node}"`;
      if (node.owner !== cmd.issuer) return `${issuer.name} does not own ${cmd.node}`;
      node.extortionRate = cmd.rate;
      return null;
    }
    case 'set_halcon_coverage': {
      const node = state.nodes[cmd.node];
      if (!node) return `unknown node "${cmd.node}"`;
      if (node.owner !== cmd.issuer) return `${issuer.name} does not own ${cmd.node}`;
      if (!Number.isInteger(cmd.coverage) || cmd.coverage < 0 || cmd.coverage > 100 || cmd.coverage % 10 !== 0)
        return 'coverage must be 0–100 in steps of 10';
      node.halconCoverage = cmd.coverage;
      return null;
    }
    case 'order_crew': {
      const crew = state.crews[cmd.crew];
      if (!crew) return `unknown crew "${cmd.crew}"`;
      if (crew.owner !== cmd.issuer) return `${issuer.name} does not command ${cmd.crew}`;
      const order = buildOrder(ctx, crew, cmd.order);
      if (typeof order === 'string') return order;
      crew.order = order;
      crew.transit.shiftAt = null;
      return null;
    }
    case 'split_crew':
      return split(ctx, cmd);
    case 'merge_crews':
      return merge(ctx, cmd);
    case 'launch_drone': {
      const road = content.roads.find((r) => r.id === cmd.road);
      if (!road) return `unknown road "${cmd.road}"`;
      const cost = content.tuning.detection.droneCost;
      if (issuer.cash < cost) return `a drone costs $${cost.toLocaleString()}`;
      issuer.cash -= cost;
      state.drones.push({
        id: newId(state, 'drone'),
        network: networkOf(state, issuer.id),
        owner: issuer.id,
        road: road.id,
        launchedAt: state.hour,
        until: state.hour + content.tuning.detection.droneRevealHours,
        rolled: [],
      });
      return null;
    }
    case 'choose_event_option': {
      const idx = state.pendingEvents.findIndex((e) => e.instance === cmd.instance);
      if (idx < 0) return `no pending event "${cmd.instance}"`;
      const pending = state.pendingEvents[idx]!;
      const def = content.events.find((e) => e.id === pending.event);
      if (!def || cmd.option < 0 || cmd.option >= def.options.length) return `invalid option ${cmd.option}`;
      // TODO(events): apply def.options[cmd.option].effects.
      state.pendingEvents.splice(idx, 1);
      return null;
    }
  }
}

function buildOrder(ctx: SimContext, crew: CrewState, req: OrderRequest): CrewOrder | string {
  const { state, content } = ctx;
  const w = world(content);
  const network = crewNetwork(state, crew);
  const group = groupOf(state, crew);
  const loc = crew.location;

  switch (req.type) {
    case 'idle':
      return { type: 'idle' };
    case 'garrison':
    case 'lie_low':
      if (loc.kind !== 'node') return `a crew must be in a node to ${req.type === 'garrison' ? 'garrison' : 'lie low'}`;
      return { type: req.type };
    case 'move': {
      if (!content.nodes.some((n) => n.id === req.destination)) return `unknown node "${req.destination}"`;
      for (const wp of req.waypoints ?? []) if (!content.nodes.some((n) => n.id === wp)) return `unknown waypoint "${wp}"`;
      const base = { crews: group, from: loc, destination: req.destination, waypoints: req.waypoints ?? [], preference: req.preference, viewer: network };
      let route = planRoute(state, content, { ...base, departHour: state.hour });
      if (!route) return `no route to ${w.node(req.destination).name} for these vehicles`;
      let departAt: number | null = null;
      const arriveAt = req.arriveAt ?? null;
      if (arriveAt !== null) {
        departAt = Math.floor(arriveAt - route.hours);
        if (departAt <= state.hour) {
          departAt = null;
          const late = Math.ceil(state.hour + route.hours - arriveAt);
          if (late > 0) pushFeed(state, 'important', `${w.node(req.destination).name} is ${Math.ceil(route.hours)}h away: this crew will arrive about ${late}h late.`, req.destination, network);
        } else {
          route = planRoute(state, content, { ...base, departHour: departAt }) ?? route;
        }
      }
      return { type: 'move', destination: req.destination, preference: req.preference, waypoints: [...(req.waypoints ?? [])], path: route.path, departAt, arriveAt };
    }
    case 'retreat': {
      const here = loc.kind === 'node' ? loc.node : null;
      const req2 = { crews: group, from: loc, departHour: state.hour, viewer: network };
      const dest = nearestNode(state, content, req2, (n) => n !== here && ownedBy(state, n, network));
      if (!dest) return 'no friendly plaza to fall back to';
      const route = planRoute(state, content, { ...req2, destination: dest, preference: 'fastest' });
      if (!route) return 'no route to a friendly plaza';
      return { type: 'retreat', destination: dest, path: route.path };
    }
    case 'ambush':
    case 'patrol': {
      const road = content.roads.find((r) => r.id === req.road);
      if (!road) return `unknown road "${req.road}"`;
      if (!allowedRoadTypes(group, content.tuning).has(road.type)) return `these vehicles cannot use a ${road.type}`;
      const onIt = loc.kind === 'road' ? loc.road === road.id : loc.node === road.from || loc.node === road.to;
      if (!onIt) return 'the crew must be at one end of the road, or on it';
      return { type: req.type, road: road.id, atKm: null };
    }
    case 'escort': {
      const target = state.crews[req.crew];
      if (!target || target.id === crew.id) return 'invalid crew to escort';
      if (target.owner !== crew.owner) return 'can only escort your own crews';
      if (target.order.type === 'escort') return 'that crew is itself an escort';
      if (escortsOf(state, crew).length) return 'this crew has escorts of its own';
      if (!sameLocation(content, loc, target.location)) return 'the crews must be in the same place';
      return { type: 'escort', crew: target.id };
    }
  }
}

function split(ctx: SimContext, cmd: Extract<Command, { type: 'split_crew' }>): string | null {
  const { state, content } = ctx;
  const { tuning } = content;
  const crew = state.crews[cmd.crew];
  if (!crew) return `unknown crew "${cmd.crew}"`;
  if (crew.owner !== cmd.issuer) return 'not your crew';
  if (crew.location.kind !== 'node') return 'crews split only in a node';
  const { minMen } = tuning.crews;
  if (!Number.isInteger(cmd.men) || cmd.men < minMen || crew.men - cmd.men < minMen)
    return `both crews need at least ${minMen} men`;
  const taken = { pickup: 0, suv: 0, motorcycle: 0, armored: 0 };
  for (const v of VEHICLE_TYPES) {
    const n = cmd.vehicles[v] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > crew.vehicles[v]) return `not enough ${v}s`;
    taken[v] = n;
  }
  const kept = { ...crew.vehicles };
  for (const v of VEHICLE_TYPES) kept[v] -= taken[v];
  if (seats({ vehicles: taken }, tuning) < cmd.men) return 'the new crew does not have enough seats';
  if (seats({ vehicles: kept }, tuning) < crew.men - cmd.men) return 'the remaining crew does not have enough seats';
  const leader = cmd.leader ?? crew.leader;
  const lc = state.characters[leader];
  if (!lc || lc.status !== 'free' || networkOf(state, leader) !== crewNetwork(state, crew)) return 'invalid leader';

  const id = newId(state, 'crew');
  state.crews[id] = {
    ...structuredClone(crew),
    id,
    leader,
    men: cmd.men,
    vehicles: taken,
    armorDamage: taken.armored ? crew.armorDamage : 0,
    order: crew.order.type === 'garrison' || crew.order.type === 'lie_low' ? { type: crew.order.type } : { type: 'idle' },
    transit: newTransit(),
  };
  crew.men -= cmd.men;
  crew.vehicles = kept;
  if (!kept.armored) crew.armorDamage = 0;
  return null;
}

function merge(ctx: SimContext, cmd: Extract<Command, { type: 'merge_crews' }>): string | null {
  const { state, content } = ctx;
  const a = state.crews[cmd.crew];
  const b = state.crews[cmd.into];
  if (!a || !b || a.id === b.id) return 'invalid crews';
  if (a.owner !== cmd.issuer || b.owner !== cmd.issuer) return 'not your crews';
  if (a.location.kind !== 'node' || !sameLocation(content, a.location, b.location)) return 'crews merge only in the same node';
  const men = a.men + b.men;
  if (men > content.tuning.crews.maxMen) return `a crew holds at most ${content.tuning.crews.maxMen} men`;
  const avg = (x: number, y: number) => (x * a.men + y * b.men) / men;
  b.skill = Math.round(avg(a.skill, b.skill));
  b.gear = Math.round(avg(a.gear, b.gear));
  b.morale = avg(a.morale, b.morale);
  b.alertness = avg(a.alertness, b.alertness);
  b.ammo = avg(a.ammo, b.ammo);
  b.fatigue = avg(a.fatigue, b.fatigue);
  b.armorDamage = Math.max(a.armorDamage, b.armorDamage);
  for (const v of VEHICLE_TYPES) b.vehicles[v] += a.vehicles[v];
  b.men = men;
  for (const e of escortsOf(state, a)) if (e.order.type === 'escort') e.order.crew = b.id;
  if (b.order.type === 'escort' && b.order.crew === a.id) b.order = { type: 'idle' };
  delete state.crews[a.id];
  return null;
}
