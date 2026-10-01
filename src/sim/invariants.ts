/**
 * Invariants: what must always be true of a GameState. Used by the fuzz tests
 * and the balance runner to prove the simulation stays sound over long
 * AI-vs-AI campaigns. Returns a list of problems (empty when healthy).
 */
import type { Content } from '../data/content';
import { VEHICLE_TYPES } from './signature';
import type { GameState } from './state';
import { world } from './world';

const EPS = 1e-6;

export function checkInvariants(state: GameState, content: Content): string[] {
  const p: string[] = [];
  const w = world(content);
  const t = content.tuning;
  const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo - EPS && v <= hi + EPS;

  for (const c of Object.values(state.crews)) {
    const at = `crew ${c.id}`;
    if (!Number.isInteger(c.men) || c.men < 1 || c.men > t.crews.maxMen) p.push(`${at}: men ${c.men}`);
    if (!state.characters[c.owner]) p.push(`${at}: unknown owner ${c.owner}`);
    else if (state.characters[c.owner]!.status === 'dead' || state.characters[c.owner]!.status === 'extradited') p.push(`${at}: owner ${c.owner} is dead`);
    if (!state.characters[c.leader]) p.push(`${at}: unknown leader ${c.leader}`);
    for (const v of VEHICLE_TYPES) if (!Number.isInteger(c.vehicles[v]) || c.vehicles[v] < 0) p.push(`${at}: ${v} ${c.vehicles[v]}`);
    if (!inRange(c.armorDamage, 0, 100)) p.push(`${at}: armorDamage ${c.armorDamage}`);
    if (!inRange(c.morale, 0, 100)) p.push(`${at}: morale ${c.morale}`);
    if (!inRange(c.ammo, 0, 100)) p.push(`${at}: ammo ${c.ammo}`);
    if (!inRange(c.fatigue, 0, 100)) p.push(`${at}: fatigue ${c.fatigue}`);
    if (!inRange(c.skill, 1, 5) || !Number.isInteger(c.skill)) p.push(`${at}: skill ${c.skill}`);
    const loc = c.location;
    if (loc.kind === 'node') {
      if (!state.nodes[loc.node]) p.push(`${at}: unknown node ${loc.node}`);
    } else {
      const road = content.roads.find((r) => r.id === loc.road);
      if (!road) p.push(`${at}: unknown road ${loc.road}`);
      else {
        if (!((loc.from === road.from && loc.to === road.to) || (loc.from === road.to && loc.to === road.from))) p.push(`${at}: bad road ends`);
        if (!inRange(loc.progressKm, 0, road.lengthKm)) p.push(`${at}: progress ${loc.progressKm}/${road.lengthKm}`);
      }
    }
    if (c.colonia !== null && !(loc.kind === 'node' && loc.node === content.culiacan.parentNode)) p.push(`${at}: colonia outside Culiacán`);
    if (c.battle !== null) {
      const b = state.battles[c.battle];
      if (!b) p.push(`${at}: in missing battle ${c.battle}`);
      else if (b.endedAt !== null) p.push(`${at}: in ended battle ${c.battle}`);
      else if (!b.attackers.crews.includes(c.id) && !b.defenders.crews.includes(c.id)) p.push(`${at}: not listed in ${c.battle}`);
    }
    const o = c.order;
    if (o.type === 'escort' && !state.crews[o.crew]) p.push(`${at}: escorting missing crew`);
    if ('path' in o) for (const s of o.path) if (!content.roads.some((r) => r.id === s.road)) p.push(`${at}: path on unknown road`);
  }

  for (const b of Object.values(state.battles)) {
    if (b.endedAt !== null) continue;
    for (const side of [b.attackers, b.defenders]) {
      for (const id of side.crews) {
        const c = state.crews[id];
        if (c && c.battle !== b.id) p.push(`battle ${b.id}: lists ${id} which is in ${c.battle}`);
      }
    }
    if (b.attackers.network === b.defenders.network) p.push(`battle ${b.id}: one network on both sides`);
  }

  for (const n of Object.values(state.nodes)) {
    const at = `plaza ${n.id}`;
    if (n.owner !== null) {
      const o = state.characters[n.owner];
      if (!o) p.push(`${at}: unknown owner`);
      else if (o.status === 'dead' || o.status === 'extradited') p.push(`${at}: owned by the dead ${n.owner}`);
    }
    if (w.node(n.id).type === 'border_exit' && n.owner !== null) p.push(`${at}: border exit owned`);
    if (n.stash < -EPS || !Number.isFinite(n.stash)) p.push(`${at}: stash ${n.stash}`);
    if (!inRange(n.support, 0, 100)) p.push(`${at}: support ${n.support}`);
    if (!inRange(n.halconCoverage, 0, 100)) p.push(`${at}: halcones ${n.halconCoverage}`);
    if (n.businesses < -EPS) p.push(`${at}: businesses ${n.businesses}`);
    if (n.recruits < -EPS) p.push(`${at}: recruits ${n.recruits}`);
    if (!inRange(n.fortification, 0, 3)) p.push(`${at}: fortification ${n.fortification}`);
  }

  for (const ch of Object.values(state.characters)) {
    if (ch.purse < -EPS || !Number.isFinite(ch.purse)) p.push(`character ${ch.id}: purse ${ch.purse}`);
    if (ch.status === 'captured' && (!ch.captor || !state.characters[ch.captor])) p.push(`character ${ch.id}: captured by nobody`);
    if (ch.faction !== null && !state.factions[ch.faction]) p.push(`character ${ch.id}: unknown faction`);
  }

  for (const f of Object.values(state.factions)) {
    if (!inRange(f.supply, 0, 100)) p.push(`faction ${f.id}: supply ${f.supply}`);
    if (!inRange(f.exhaustion, 0, 100)) p.push(`faction ${f.id}: exhaustion ${f.exhaustion}`);
    if (f.head !== null && !state.characters[f.head]) p.push(`faction ${f.id}: unknown head`);
  }
  for (const r of Object.values(state.regions)) if (!inRange(r.calentura, 0, 100)) p.push(`region ${r.id}: calentura ${r.calentura}`);
  for (const c of Object.values(state.colonias)) if (!inRange(c.control, -100, 100)) p.push(`colonia ${c.id}: control ${c.control}`);
  for (const r of state.requests) if (!state.characters[r.to] || !state.characters[r.from]) p.push(`request ${r.id}: unknown character`);
  if (state.market.armored < 0) p.push(`market: armored ${state.market.armored}`);
  for (const ch of Object.values(state.characters)) {
    for (const k of ['fear', 'credibility', 'stateIntel', 'profile', 'health'] as const) if (!inRange(ch[k], 0, 100)) p.push(`character ${ch.id}: ${k} ${ch[k]}`);
  }
  const eventIds = new Set(content.events.map((e) => e.id));
  for (const e of state.pendingEvents) {
    if (!eventIds.has(e.event)) p.push(`pending event ${e.instance}: unknown event ${e.event}`);
    if (!state.characters[e.decider]) p.push(`pending event ${e.instance}: unknown decider`);
  }
  for (const e of state.scheduledEvents) if (!eventIds.has(e.event)) p.push(`scheduled event: unknown event ${e.event}`);
  for (const s of state.schemes) {
    if (!state.characters[s.owner]) p.push(`scheme ${s.id}: unknown owner`);
    if (!inRange(s.progress, 0, 100)) p.push(`scheme ${s.id}: progress ${s.progress}`);
  }
  for (const pact of state.pacts) for (const id of pact.parties) if (!state.characters[id]) p.push(`pact ${pact.id}: unknown party ${id}`);
  for (const r of [...state.rumors, ...state.publicClaims]) if (!state.characters[r.owner]) p.push(`${r.id}: unknown owner`);
  for (const op of state.operations) {
    if (!state.characters[op.proposer]) p.push(`operation ${op.id}: unknown proposer`);
    if (!state.nodes[op.target]) p.push(`operation ${op.id}: unknown target`);
    for (const inv of op.invites) if (!state.characters[inv.to]) p.push(`operation ${op.id}: unknown invitee ${inv.to}`);
  }
  for (const o of state.pactOffers) if (!state.characters[o.from] || !state.characters[o.to]) p.push(`pact offer ${o.id}: unknown character`);
  for (const d of state.drones) if ((d.road === null) === (d.node === null)) p.push(`drone ${d.id}: needs exactly one of road or town`);
  for (const i of state.informants) {
    if (!state.nodes[i.node]) p.push(`informant ${i.id}: unknown town ${i.node}`);
    if (!state.characters[i.owner]) p.push(`informant ${i.id}: unknown handler`);
    if (i.quality < 0 || i.quality > 1) p.push(`informant ${i.id}: quality ${i.quality} out of range`);
  }
  for (const r of state.reports) if (!(r.low <= r.men && r.men <= r.high)) p.push(`report ${r.id}: ${r.men} outside its range ${r.low}–${r.high}`);
  for (const b of Object.values(state.battles)) {
    for (const side of [b.attackers, b.defenders]) for (const [o, n] of Object.entries(side.ownerLosses)) if (n > (side.ownerMen[o] ?? 0) + 1e-9) p.push(`battle ${b.id}: ${o} lost more men than he brought`);
  }
  if (!state.characters[state.playerId]) p.push(`unknown player ${state.playerId}`);
  return p;
}
