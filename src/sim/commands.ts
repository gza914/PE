/**
 * Commands are the only way to change game state from outside the sim. The UI
 * and the AI both issue them; the core validates and applies them at the start
 * of the next tick. Orders name intent (go here, fastest); the sim plans the
 * path itself with the issuer's own knowledge.
 */
import type { ExtortionRate, SchemeType, VehicleType } from '../data/schemas';
import { declare } from './diplomacy';
import { acceptCounter, cancelOperation, proposeOperation, respondOperation, withdrawFromOperation, type ProposeSpec, type RespondSpec } from './operations';
import { buyWeapons, columnBlocked, hireMercenaries, hireVeterans, stopTraining, trainCrew } from './forces';
import { acceptCounter as acceptOutsideCounter, answerDefection, proposeDeal, walkAway } from './outside';
import { decideCaptive, type CaptiveOption } from './capture';
import { campBlocked, sweep } from './countryside';
import { chooseLost, type LostChoice } from './remnants';
import { launchDrone, plantInformant, pullInformant } from './intel';
import { breakPact, proposePact, respondPact, type PactSpec } from './pacts';
import { chooseOption } from './systems/events';
import { infowarCommand, type InfowarCommand } from './systems/infowar';
import { cancelScheme, startScheme } from './systems/schemes';
import { stateCommand, type StateCommand } from './systems/stateForces';
import { newId, pushFeed, type SimContext } from './context';
import { escortsOf, groupOf, sameLocation } from './crews';
import { crewNetwork, networkOf, ownedBy } from './network';
import { cashOf, deposit, moveCash, spend } from './money';
import { newTransit } from './newGame';
import { nearestNode, planRoute } from './routing';
import { allowedRoadTypes, seats, VEHICLE_TYPES } from './signature';
import type { CrewOrder, CrewState, Id, OutsideAsk, OutsideOffer, RoutePreference } from './state';
import { respondToRequest } from './requests';
import { acceptSurrender, callForHelp, reinforceOrder, sideOf } from './systems/combat';
import { endGame } from './systems/endings';
import { world } from './world';

interface Base {
  /** Character issuing the command. */
  issuer: Id;
}

export type OrderRequest =
  | {
      type: 'move';
      destination: Id;
      preference: RoutePreference;
      waypoints?: Id[];
      arriveAt?: number | null;
      avoidRivalPlazas?: boolean;
      onArrive?: 'lie_low' | 'camp';
    }
  | { type: 'retreat' }
  | { type: 'garrison' }
  | { type: 'lie_low' }
  | { type: 'camp' }
  | { type: 'idle' }
  | { type: 'ambush'; road: Id }
  | { type: 'patrol'; road: Id }
  | { type: 'escort'; crew: Id }
  | { type: 'raid'; target: Id; preference: RoutePreference; arriveAt?: number | null; avoidRivalPlazas?: boolean };

export type Command =
  | (Base & { type: 'declare_alignment'; faction: Id | null })
  | (Base & { type: 'set_extortion_rate'; node: Id; rate: ExtortionRate })
  | (Base & { type: 'set_halcon_coverage'; node: Id; coverage: number })
  | (Base & { type: 'order_crew'; crew: Id; order: OrderRequest })
  | (Base & { type: 'split_crew'; crew: Id; men: number; vehicles: Partial<Record<VehicleType, number>>; leader?: Id })
  | (Base & { type: 'merge_crews'; crew: Id; into: Id })
  | (Base & { type: 'launch_drone'; road?: Id; node?: Id })
  | (Base & { type: 'plant_informant'; node: Id })
  | (Base & { type: 'outside_deal'; cartel: Id; ask: OutsideAsk; offer: OutsideOffer; deal?: Id | null })
  | (Base & { type: 'outside_accept'; deal: Id })
  | (Base & { type: 'outside_walk'; deal: Id })
  | (Base & { type: 'answer_defection'; crew: Id; accept: boolean })
  | (Base & { type: 'sweep'; crew: Id })
  | (Base & { type: 'captive'; captive: Id; option: CaptiveOption; trade?: Id | null })
  | (Base & { type: 'lost_everything'; choice: LostChoice; boss?: Id | null })
  | (Base & { type: 'train_crew'; crew: Id })
  | (Base & { type: 'stop_training'; crew: Id })
  | (Base & { type: 'buy_weapons'; crew: Id; gear: number })
  | (Base & { type: 'hire_veterans'; crew: Id; men: number })
  | (Base & { type: 'hire_mercenaries'; node: Id; men: number })
  | (Base & { type: 'pull_informant'; informant: Id })
  | (Base & { type: 'recruit'; crew: Id; men: number })
  | (Base & { type: 'form_crew'; node: Id; men: number; leader?: Id })
  | (Base & { type: 'buy_vehicles'; crew: Id; vehicle: VehicleType; count: number })
  | (Base & { type: 'move_cash'; from: Id; to: Id; amount: number })
  | (Base & { type: 'request_aid' })
  | (Base & { type: 'respond_request'; request: Id; accept: boolean; amount?: number })
  | (Base & { type: 'accept_truce' })
  | (Base & { type: 'deploy_crew'; crew: Id; colonia: Id | null })
  | (Base & { type: 'battle_withdraw'; battle: Id })
  | (Base & { type: 'battle_armor_forward'; battle: Id })
  | (Base & { type: 'battle_call_help'; battle: Id })
  | (Base & { type: 'battle_commit'; battle: Id; crew: Id })
  | (Base & { type: 'battle_accept_surrender'; battle: Id })
  | (Base & { type: 'choose_event_option'; instance: Id; option: number })
  | (Base & { type: 'start_scheme'; scheme: SchemeType; target: Id })
  | (Base & { type: 'cancel_scheme'; scheme: Id })
  | (Base & { type: 'propose_operation' } & ProposeSpec)
  | (Base & { type: 'respond_operation' } & RespondSpec)
  | (Base & { type: 'accept_counter'; op: Id; invitee: Id })
  | (Base & { type: 'cancel_operation'; op: Id })
  | (Base & { type: 'withdraw_operation'; op: Id })
  | (Base & { type: 'propose_pact' } & PactSpec)
  | (Base & { type: 'respond_pact'; offer: Id; accept: boolean })
  | (Base & { type: 'break_pact'; pact: Id })
  | StateCommand
  | InfowarCommand;

export interface Rejection {
  command: Command;
  reason: string;
}

/** Applies one command in place. Returns a reason string if it was rejected. */
export function applyCommand(ctx: SimContext, cmd: Command): string | null {
  const { state, content } = ctx;
  const issuer = state.characters[cmd.issuer];
  if (!issuer) return `unknown issuer "${cmd.issuer}"`;
  // A prisoner can still answer events about their situation; nothing else.
  if (issuer.status !== 'free' && !(cmd.type === 'choose_event_option' && issuer.status === 'jailed')) return `${issuer.name} is ${issuer.status}`;

  switch (cmd.type) {
    case 'declare_alignment': {
      if (cmd.faction !== null && !content.factions.some((f) => f.id === cmd.faction && f.kind === 'major'))
        return `"${cmd.faction}" is not a major faction`;
      declare(ctx, issuer.id, cmd.faction);
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
      if (!Number.isInteger(cmd.coverage) || cmd.coverage < 0 || cmd.coverage > 100) return 'coverage must be a whole number from 0 to 100';
      node.halconCoverage = cmd.coverage;
      return null;
    }
    case 'order_crew': {
      const crew = state.crews[cmd.crew];
      if (!crew) return `unknown crew "${cmd.crew}"`;
      if (crew.owner !== cmd.issuer) return `${issuer.name} does not command ${cmd.crew}`;
      if (crew.battle !== null) return 'that crew is in a battle; use the battle orders';
      const order = buildOrder(ctx, crew, cmd.order);
      if (typeof order === 'string') return order;
      crew.order = order;
      crew.transit.shiftAt = null;
      return null;
    }
    case 'deploy_crew': {
      const crew = state.crews[cmd.crew];
      if (!crew || crew.owner !== cmd.issuer) return 'not your crew';
      if (crew.battle !== null) return 'that crew is in a battle';
      if (crew.location.kind !== 'node' || crew.location.node !== content.culiacan.parentNode) return 'crews deploy to colonias only inside Culiacán';
      if (cmd.colonia !== null && !content.culiacan.colonias.some((c) => c.id === cmd.colonia)) return `unknown colonia "${cmd.colonia}"`;
      crew.colonia = cmd.colonia;
      return null;
    }
    case 'battle_withdraw':
    case 'battle_armor_forward':
    case 'battle_call_help':
    case 'battle_commit':
    case 'battle_accept_surrender':
      return battleCommand(ctx, cmd);
    case 'respond_request':
      return respondToRequest(ctx, cmd.issuer, cmd.request, cmd.accept, cmd.amount);
    case 'propose_operation':
      return proposeOperation(ctx, cmd.issuer, cmd);
    case 'respond_operation':
      return respondOperation(ctx, cmd.issuer, cmd);
    case 'accept_counter':
      return acceptCounter(ctx, cmd.issuer, cmd.op, cmd.invitee);
    case 'cancel_operation':
      return cancelOperation(ctx, cmd.issuer, cmd.op);
    case 'withdraw_operation':
      return withdrawFromOperation(ctx, cmd.issuer, cmd.op);
    case 'propose_pact':
      return proposePact(ctx, cmd.issuer, cmd);
    case 'respond_pact':
      return respondPact(ctx, cmd.issuer, cmd.offer, cmd.accept);
    case 'break_pact':
      return breakPact(ctx, cmd.issuer, cmd.pact);
    case 'accept_truce': {
      if (!state.truceOffered) return 'no truce is on the table';
      if (!content.factions.some((f) => state.factions[f.id]?.head === cmd.issuer)) return 'only a faction head can agree to a truce';
      endGame(ctx, 'negotiated_truce', null, 'You agree to the truce. The war is over.');
      return null;
    }
    case 'recruit':
    case 'form_crew':
    case 'buy_vehicles':
    case 'move_cash':
    case 'request_aid':
      return economyCommand(ctx, cmd);
    case 'split_crew':
      return split(ctx, cmd);
    case 'merge_crews':
      return merge(ctx, cmd);
    case 'launch_drone':
      return launchDrone(ctx, issuer.id, cmd.road ?? null, cmd.node ?? null);
    case 'plant_informant':
      return plantInformant(ctx, issuer.id, cmd.node);
    case 'outside_deal':
      return proposeDeal(ctx, issuer.id, { cartel: cmd.cartel, ask: cmd.ask, offer: cmd.offer, deal: cmd.deal ?? null });
    case 'outside_accept':
      return acceptOutsideCounter(ctx, issuer.id, cmd.deal);
    case 'outside_walk':
      return walkAway(ctx, issuer.id, cmd.deal);
    case 'answer_defection':
      return answerDefection(ctx, issuer.id, cmd.crew, cmd.accept);
    case 'captive':
      return decideCaptive(ctx, issuer.id, cmd.captive, cmd.option, cmd.trade ?? null);
    case 'lost_everything':
      return chooseLost(ctx, issuer.id, cmd.choice, cmd.boss ?? null);
    case 'sweep':
      return sweep(ctx, issuer.id, cmd.crew);
    case 'train_crew':
      return trainCrew(ctx, issuer.id, cmd.crew);
    case 'stop_training':
      return stopTraining(ctx, issuer.id, cmd.crew);
    case 'buy_weapons':
      return buyWeapons(ctx, issuer.id, cmd.crew, cmd.gear);
    case 'hire_veterans':
      return hireVeterans(ctx, issuer.id, cmd.crew, cmd.men);
    case 'hire_mercenaries':
      return hireMercenaries(ctx, issuer.id, cmd.node, cmd.men);
    case 'pull_informant':
      return pullInformant(ctx, issuer.id, cmd.informant);
    case 'choose_event_option':
      return chooseOption(ctx, cmd.issuer, cmd.instance, cmd.option);
    case 'start_scheme':
      if (!content.tuning.schemes.enabled) return 'schemes are switched off';
      return startScheme(ctx, cmd.issuer, cmd.scheme, cmd.target);
    case 'cancel_scheme':
      return cancelScheme(ctx, cmd.issuer, cmd.scheme);
    case 'bribe_commander':
    case 'bribe_police':
    case 'tip_off':
    case 'hand_over_scapegoat':
    case 'lie_low_region':
      return stateCommand(ctx, cmd);
    case 'narcomanta':
    case 'video':
    case 'social_claim':
    case 'commission_corrido':
    case 'plant_rumor':
    case 'show_of_force':
      return infowarCommand(ctx, cmd);
  }
}

/**
 * Gives a crew an order on its owner's behalf (used when a boss accepts a
 * joint operation). Returns a reason if the order is impossible.
 */
export function orderCrew(ctx: SimContext, crew: CrewState, req: OrderRequest): string | null {
  if (crew.battle !== null) return 'that crew is in a battle';
  const order = buildOrder(ctx, crew, req);
  if (typeof order === 'string') return order;
  crew.order = order;
  crew.transit.shiftAt = null;
  return null;
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
      return req.type === 'lie_low' ? { type: 'lie_low', since: state.hour } : { type: 'garrison' };
    case 'camp': {
      if (loc.kind !== 'node') return 'a crew camps in the hills around a plaza: get there first';
      const why = campBlocked(content, loc.node);
      if (why) return why;
      return { type: 'camp', since: state.hour };
    }
    case 'move': {
      if (!content.nodes.some((n) => n.id === req.destination)) return `unknown node "${req.destination}"`;
      for (const wp of req.waypoints ?? []) if (!content.nodes.some((n) => n.id === wp)) return `unknown waypoint "${wp}"`;
      const noPassThrough = req.avoidRivalPlazas ? rivalPlazaIds(state, network).filter((n) => n !== req.destination) : [];
      const base = { crews: group, from: loc, destination: req.destination, waypoints: req.waypoints ?? [], preference: req.preference, viewer: network, noPassThrough };
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
      return {
        type: 'move',
        destination: req.destination,
        preference: req.preference,
        waypoints: [...(req.waypoints ?? [])],
        path: route.path,
        departAt,
        arriveAt,
        ...(req.onArrive ? { onArrive: req.onArrive } : {}),
      };
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
      return { type: req.type, road: road.id, atKm: null, since: state.hour };
    }
    case 'raid': {
      const target = content.nodes.find((n) => n.id === req.target);
      if (!target) return `unknown node "${req.target}"`;
      if (target.type === 'border_exit' || target.id === content.culiacan.parentNode) return `${target.name} cannot be raided; fight for Culiacán colonia by colonia`;
      if (ownedBy(state, target.id, network)) return `${target.name} is already yours`;
      const noPassThrough = req.avoidRivalPlazas ? rivalPlazaIds(state, network).filter((n) => n !== target.id) : [];
      const base = { crews: group, from: loc, destination: target.id, preference: req.preference, viewer: network, noPassThrough };
      let route = planRoute(state, content, { ...base, departHour: state.hour });
      if (!route) return `no route to ${target.name} for these vehicles`;
      // Sync arrival, as for moves: wait, then leave in time to hit together.
      let departAt: number | null = null;
      const arriveAt = req.arriveAt ?? null;
      if (arriveAt !== null) {
        departAt = Math.floor(arriveAt - route.hours);
        if (departAt <= state.hour) departAt = null;
        else route = planRoute(state, content, { ...base, departHour: departAt }) ?? route;
      }
      return { type: 'raid', target: target.id, preference: req.preference, path: route.path, departAt, arriveAt };
    }
    case 'escort': {
      const target = state.crews[req.crew];
      if (!target || target.id === crew.id) return 'invalid crew to escort';
      if (target.owner !== crew.owner) return 'can only escort your own crews';
      if (target.order.type === 'escort') return 'that crew is itself an escort';
      if (escortsOf(state, crew).length) return 'this crew has escorts of its own';
      if (!sameLocation(content, loc, target.location)) return 'the crews must be in the same place';
      const column = columnBlocked(state, content.tuning, crew, target);
      if (column) return column;
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
    order: crew.order.type === 'garrison' || crew.order.type === 'lie_low' ? { type: crew.order.type } : crew.order.type === 'camp' ? { type: 'camp', since: state.hour } : { type: 'idle' },
    transit: newTransit(),
    training: null,
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

type BattleCommand = Extract<Command, { type: 'battle_withdraw' | 'battle_armor_forward' | 'battle_call_help' | 'battle_commit' | 'battle_accept_surrender' }>;

/** The player's decisions during a battle (GDD "Player decisions mid-battle"). */
function battleCommand(ctx: SimContext, cmd: BattleCommand): string | null {
  const { state } = ctx;
  const b = state.battles[cmd.battle];
  if (!b || b.endedAt !== null) return 'that battle is over';
  const k = sideOf(b, networkOf(state, cmd.issuer));
  if (!k) return 'your side is not in this battle';
  const mine = b[k].crews.map((id) => state.crews[id]).filter((c): c is CrewState => !!c && c.owner === cmd.issuer);
  switch (cmd.type) {
    case 'battle_withdraw':
      if (!mine.length) return 'none of your crews are fighting here';
      b.withdrawing = [...new Set([...b.withdrawing, ...mine.map((c) => c.id)])];
      return null;
    case 'battle_armor_forward': {
      const trucks = mine.filter((c) => c.vehicles.armored > 0);
      if (!trucks.length) return 'you have no armored trucks in this fight';
      b.armorPush = [...new Set([...b.armorPush, ...trucks.map((c) => c.id)])];
      return null;
    }
    case 'battle_call_help':
      if (b[k].helpCalled) return 'help was already requested';
      return callForHelp(ctx, b, k) > 0 ? null : 'no one nearby can come in time';
    case 'battle_commit': {
      const crew = state.crews[cmd.crew];
      if (!crew || crew.owner !== cmd.issuer) return 'not your crew';
      if (crew.battle !== null) return 'that crew is already fighting';
      const order = reinforceOrder(ctx, crew, b);
      if (!order) return 'that crew cannot reach the battle';
      crew.order = order;
      return null;
    }
    case 'battle_accept_surrender':
      return acceptSurrender(ctx, b, cmd.issuer);
  }
}

type EconomyCommand = Extract<Command, { type: 'recruit' | 'form_crew' | 'buy_vehicles' | 'move_cash' | 'request_aid' }>;

/** Spending and moving money (GDD "Economy"). */
function economyCommand(ctx: SimContext, cmd: EconomyCommand): string | null {
  const { state, content } = ctx;
  const e = content.tuning.economy;
  const r = e.recruitment;
  const w = world(content);
  const ownPlaza = (node: Id | null) => (node && state.nodes[node]?.owner === cmd.issuer ? state.nodes[node]! : null);
  switch (cmd.type) {
    case 'recruit': {
      const crew = state.crews[cmd.crew];
      if (!crew || crew.owner !== cmd.issuer) return 'not your crew';
      if (crew.battle !== null) return 'that crew is in a battle';
      const plaza = ownPlaza(crew.location.kind === 'node' ? crew.location.node : null);
      if (!plaza) return 'crews recruit only in a plaza you hold';
      if (!Number.isInteger(cmd.men) || cmd.men < 1) return 'recruit at least one man';
      if (cmd.men > Math.floor(plaza.recruits)) return `only ${Math.floor(plaza.recruits)} men are ready to sign up in ${w.node(plaza.id).name}`;
      if (crew.men + cmd.men > content.tuning.crews.maxMen) return `a crew holds at most ${content.tuning.crews.maxMen} men`;
      if (seats(crew, content.tuning) < crew.men + cmd.men) return 'not enough seats: buy vehicles first';
      if (!spend(state, content, cmd.issuer, cmd.men * r.signingCostPerMan, 'recruits')) return `signing ${cmd.men} men costs $${(cmd.men * r.signingCostPerMan).toLocaleString()}`;
      plaza.recruits -= cmd.men;
      crew.skill = Math.max(1, Math.round((crew.skill * crew.men + r.recruitSkill * cmd.men) / (crew.men + cmd.men)));
      crew.men += cmd.men;
      crew.establishment = Math.max(crew.establishment, crew.men);
      return null;
    }
    case 'form_crew': {
      const plaza = ownPlaza(cmd.node);
      if (!plaza) return 'crews are raised only in a plaza you hold';
      const { minMen, maxMen } = content.tuning.crews;
      if (!Number.isInteger(cmd.men) || cmd.men < minMen || cmd.men > maxMen) return `a crew has ${minMen}–${maxMen} men`;
      if (cmd.men > Math.floor(plaza.recruits)) return `only ${Math.floor(plaza.recruits)} men are ready to sign up in ${w.node(plaza.id).name}`;
      const leader = cmd.leader ?? cmd.issuer;
      const lc = state.characters[leader];
      if (!lc || lc.status !== 'free' || networkOf(state, leader) !== networkOf(state, cmd.issuer)) return 'invalid leader';
      const pickups = Math.ceil(cmd.men / content.tuning.vehicles.pickup.seats);
      const cost = cmd.men * r.signingCostPerMan + pickups * content.tuning.vehicles.pickup.cost;
      if (cashOf(state, cmd.issuer) < cost) return `raising this crew costs $${cost.toLocaleString()}`;
      spend(state, content, cmd.issuer, cmd.men * r.signingCostPerMan, 'recruits');
      spend(state, content, cmd.issuer, pickups * content.tuning.vehicles.pickup.cost, 'vehicles');
      plaza.recruits -= cmd.men;
      const id = newId(state, 'crew');
      state.crews[id] = {
        id,
        owner: cmd.issuer,
        leader,
        men: cmd.men,
        skill: r.recruitSkill,
        gear: r.recruitGear,
        morale: content.tuning.crews.startingMorale,
        alertness: content.tuning.crews.startingAlertness,
        ammo: 100,
        fatigue: 0,
        vehicles: { pickup: pickups, suv: 0, motorcycle: 0, armored: 0 },
        armorDamage: 0,
        location: { kind: 'node', node: plaza.id },
        order: { type: 'garrison' },
        transit: newTransit(),
        battle: null,
        colonia: null,
        battles: 0,
        establishment: cmd.men,
        training: null,
        hired: null,
      };
      return null;
    }
    case 'buy_vehicles': {
      const crew = state.crews[cmd.crew];
      if (!crew || crew.owner !== cmd.issuer) return 'not your crew';
      if (!ownPlaza(crew.location.kind === 'node' ? crew.location.node : null)) return 'vehicles are bought in a plaza you hold';
      if (!Number.isInteger(cmd.count) || cmd.count < 1) return 'buy at least one';
      if (cmd.vehicle === 'armored' && cmd.count > state.market.armored) return `only ${state.market.armored} armored trucks are for sale right now`;
      const cost = cmd.count * content.tuning.vehicles[cmd.vehicle].cost;
      if (!spend(state, content, cmd.issuer, cost, 'vehicles')) return `that costs $${cost.toLocaleString()}`;
      if (cmd.vehicle === 'armored') state.market.armored -= cmd.count;
      crew.vehicles[cmd.vehicle] += cmd.count;
      return null;
    }
    case 'move_cash': {
      const err = moveCash(state, cmd.issuer, cmd.from, cmd.to, cmd.amount);
      if (err === null) state.characters[cmd.issuer]!.lastCashMoveAt = state.hour;
      return err;
    }
    case 'request_aid': {
      const me = state.characters[cmd.issuer]!;
      if (!me.faction) return 'neutrals have no faction to ask';
      const head = state.factions[me.faction]?.head;
      if (!head || head === cmd.issuer || state.characters[head]?.status !== 'free') return 'there is no one to ask';
      const cooldown = e.aid.cooldownDays * 24;
      if (me.lastAidAt !== null && state.hour - me.lastAidAt < cooldown) return `the faction helped you ${Math.floor((state.hour - me.lastAidAt) / 24)} days ago; ask again in ${Math.ceil((cooldown - (state.hour - me.lastAidAt)) / 24)} days`;
      const amount = Math.floor(Math.min(e.aid.maxCash, cashOf(state, head) * e.aid.headCashShare));
      if (amount <= 0 || !spend(state, content, head, amount, 'aid')) return `${state.characters[head]!.alias ?? state.characters[head]!.name} has nothing to spare`;
      deposit(state, content, cmd.issuer, amount, 'aid');
      me.lastAidAt = state.hour;
      pushFeed(state, 'important', `The faction sent you $${amount.toLocaleString()}.`, null, networkOf(state, cmd.issuer));
      return null;
    }
  }
}

/** Plazas held by networks other than `network`, sorted. */
export function rivalPlazaIds(state: import('./state').GameState, network: Id): Id[] {
  return Object.values(state.nodes)
    .filter((n) => n.owner !== null && networkOf(state, n.owner) !== network)
    .map((n) => n.id)
    .sort();
}
