/**
 * Battle stances and one-off actions (GDD "Battles"). Every few hours each
 * owner in a fight picks a stance for the next stretch: assault, hold, flank,
 * or probe. One-off actions: dig in, a drone overhead, hit the relief column,
 * offer terms, and (after a win) execute prisoners. You command only your own
 * crews; in a joint fight each owner sets his own stance.
 */
import type { Content } from '../data/content';
import { newId, pushFeed, type SimContext } from './context';
import { orderCrew } from './commands';
import { spend } from './money';
import { crewNetwork, networkOf } from './network';
import { charName } from './orders';
import { chance } from './rng';
import type { Battle, CrewState, GameState, Id, Stance } from './state';
import { world } from './world';

export const STANCES: Stance[] = ['assault', 'hold', 'flank', 'probe'];

type Side = 'attackers' | 'defenders';
const other = (k: Side): Side => (k === 'attackers' ? 'defenders' : 'attackers');

/** The side an owner's crews fight on (his network may have changed mid-fight). */
function sideOfOwner(state: GameState, b: Battle, owner: Id): Side | null {
  for (const k of ['attackers', 'defenders'] as const) if (b[k].crews.some((id) => state.crews[id]?.owner === owner)) return k;
  const net = networkOf(state, owner);
  return b.attackers.network === net ? 'attackers' : b.defenders.network === net ? 'defenders' : null;
}

function ownCrews(state: GameState, b: Battle, owner: Id): CrewState[] {
  return [...b.attackers.crews, ...b.defenders.crews].map((id) => state.crews[id]).filter((c): c is CrewState => !!c && c.owner === owner && c.men > 0);
}

/** Damage an owner's crews deal this hour, as a multiplier. */
export function dealtMultiplier(content: Content, b: Battle, owner: Id): number {
  const t = content.tuning.battle;
  const s = b.stances[owner];
  let m = s ? t.stances[s]!.dealt : 1;
  if (s === 'flank' && b.flank[owner]) m *= t.flank.successDealt;
  if (b.digging.includes(owner)) m *= t.digIn.dealt;
  return m;
}

/** Damage an owner's crews take this hour, as a multiplier. */
export function takenMultiplier(content: Content, b: Battle, owner: Id): number {
  const t = content.tuning.battle;
  const s = b.stances[owner];
  let m = s ? t.stances[s]!.taken : 1;
  if (s === 'flank' && b.flank[owner] === false) m *= t.flank.failTaken;
  return m;
}

function terrainKey(content: Content, b: Battle): string {
  const w = world(content);
  return b.where.kind === 'road' ? w.road(b.where.road).terrain : content.tuning.combat.nodeTerrain[w.node(b.where.node).type] ?? 'open_valley';
}

export function stanceBlocked(state: GameState, content: Content, b: Battle, owner: Id, stance: Stance): string | null {
  if (!STANCES.includes(stance)) return 'unknown stance';
  const mine = ownCrews(state, b, owner);
  if (!mine.length) return 'none of your crews are fighting here';
  if (stance === 'flank') {
    const f = content.tuning.battle.flank;
    if (mine.length < f.minCrews) return `a flank needs ${f.minCrews} crews`;
    if (f.badTerrain.includes(terrainKey(content, b))) return 'no room to flank here';
  }
  return null;
}

/** Pick a stance for the next stretch. A flank is rolled when ordered. */
export function setStance(ctx: SimContext, b: Battle, owner: Id, stance: Stance): string | null {
  const { state, content } = ctx;
  const blocked = stanceBlocked(state, content, b, owner, stance);
  if (blocked) return blocked;
  b.stances[owner] = stance;
  delete b.flank[owner];
  if (stance === 'flank') {
    const f = content.tuning.battle.flank;
    const mine = ownCrews(state, b, owner);
    const skill = mine.reduce((n, c) => n + c.skill * c.men, 0) / Math.max(1, mine.reduce((n, c) => n + c.men, 0));
    const astucia = state.characters[mine[0]!.leader]?.skills.astucia ?? 10;
    b.flank[owner] = chance(state.rng, Math.min(0.9, f.baseChance + f.perSkill * skill + f.perAstucia * astucia));
    b.log.push(`H${b.hours + 1}: ${charName(ctx, owner)}'s men try to flank: ${b.flank[owner] ? 'they get around the enemy' : 'they are spotted and exposed'}.`);
  }
  return null;
}

/** Hourly, after damage: probes reveal, digging fortifies, and the next decision comes due. */
export function afterHour(ctx: SimContext, b: Battle): void {
  const { state, content } = ctx;
  const t = content.tuning.battle;
  for (const owner of Object.keys(b.stances).sort()) {
    if (b.stances[owner] !== 'probe') continue;
    const k = sideOfOwner(state, b, owner);
    if (!k) continue;
    const net = networkOf(state, owner);
    for (const id of b[other(k)].crews) {
      const c = state.crews[id];
      if (!c) continue;
      state.reports.push({ id: newId(state, 'rep'), network: net, crew: c.id, owner: c.owner, men: c.men, low: c.men, high: c.men, vehicles: {}, where: structuredClone(c.location), roadType: null, hour: state.hour, confidence: 'confirmed', source: 'presence', planted: false });
    }
  }
  if (b.digging.length) {
    b.fortification = Math.min(t.digIn.maxFortification, b.fortification + 1);
    b.log.push(`H${b.hours}: the defenders dug in (fortification ${b.fortification}).`);
    b.digging = [];
  }
  if (state.hour >= b.nextDecisionAt) {
    b.nextDecisionAt = state.hour + t.decisionEveryHours;
    const me = state.playerId;
    if (ownCrews(state, b, me).length && b.endedAt === null) {
      const where = b.where.kind === 'node' ? world(content).node(b.where.node).name : 'the road';
      pushFeed(state, 'critical', `Fighting at ${where}, hour ${b.hours}: pick your stance for the next ${t.decisionEveryHours} hours.`, null, networkOf(state, me), b.id);
    }
  }
}

export function digIn(ctx: SimContext, b: Battle, owner: Id): string | null {
  const { state, content } = ctx;
  if (sideOfOwner(state, b, owner) !== 'defenders' || b.where.kind !== 'node') return 'only defenders in a plaza can dig in';
  if (b.fortification >= content.tuning.battle.digIn.maxFortification) return 'they are dug in as deep as they can go';
  if (!ownCrews(state, b, owner).length) return 'none of your crews are fighting here';
  if (!b.digging.includes(owner)) b.digging.push(owner);
  return null;
}

/** A drone overhead: see who is coming to help either side. */
export function battleDrone(ctx: SimContext, b: Battle, owner: Id): string | null {
  const { state, content } = ctx;
  const k = sideOfOwner(state, b, owner);
  if (!k) return 'your side is not in this battle';
  const cost = content.tuning.detection.droneCost;
  if (!spend(state, content, owner, cost, 'drones')) return `a drone costs $${cost.toLocaleString()}`;
  const net = networkOf(state, owner);
  const node = b.where.kind === 'node' ? b.where.node : null;
  const coming = Object.values(state.crews)
    .filter((c) => crewNetwork(state, c) !== net && c.battle === null && ((c.order.type === 'reinforce' && c.order.battle === b.id) || (node !== null && (c.order.type === 'move' || c.order.type === 'raid') && ('destination' in c.order ? c.order.destination : c.order.target) === node)))
    .sort((a, b2) => (a.id < b2.id ? -1 : 1));
  for (const c of coming) state.reports.push({ id: newId(state, 'rep'), network: net, crew: c.id, owner: c.owner, men: c.men, low: c.men, high: c.men, vehicles: {}, where: structuredClone(c.location), roadType: null, hour: state.hour, confidence: 'confirmed', source: 'drone', planted: false });
  if (owner === state.playerId) {
    const men = coming.reduce((n, c) => n + c.men, 0);
    pushFeed(state, 'important', coming.length ? `Drone overhead: ${coming.length} crew${coming.length > 1 ? 's' : ''} (${men} men) on the way to help them.` : 'Drone overhead: no one is coming to help them.', node, net, b.id);
  }
  return null;
}

/** Send a crew to ambush help on its way: it takes up an ambush on the relief column's road. */
export function hitRelief(ctx: SimContext, b: Battle, owner: Id, crewId: Id, targetId: Id): string | null {
  const { state } = ctx;
  const crew = state.crews[crewId];
  if (!crew || crew.owner !== owner) return 'not your crew';
  if (crew.battle !== null) return 'that crew is already fighting';
  const target = state.crews[targetId];
  const net = networkOf(state, owner);
  if (!target || target.location.kind !== 'road') return 'pick a crew on the road';
  if (!state.reports.some((r) => r.network === net && r.crew === targetId && state.hour - r.hour <= 2)) return 'you have no fresh sighting of that crew';
  return orderCrew(ctx, crew, { type: 'ambush', road: target.location.road });
}

/** Offer the other side terms to leave. They take them if they are losing badly. */
export function offerTerms(ctx: SimContext, b: Battle, owner: Id): string | null {
  const { state, content } = ctx;
  const k = sideOfOwner(state, b, owner);
  if (!k) return 'your side is not in this battle';
  const them = other(k);
  const t = content.tuning.battle.terms;
  const theirs = b[them].crews.map((id) => state.crews[id]).filter((c): c is CrewState => !!c && c.men > 0);
  if (theirs.some((c) => c.owner === state.playerId) && owner !== state.playerId) return null;
  const morale = theirs.reduce((n, c) => n + c.morale * c.men, 0) / Math.max(1, theirs.reduce((n, c) => n + c.men, 0));
  const accept = b[them].power <= t.acceptRatio * b[k].power || morale <= t.acceptMorale;
  if (!accept) {
    if (owner === state.playerId) pushFeed(state, 'important', 'They refused your terms.', null, networkOf(state, owner), b.id);
    return null;
  }
  b.withdrawing = [...new Set([...b.withdrawing, ...theirs.map((c) => c.id)])];
  b.log.push(`H${b.hours + 1}: the ${them} took terms and pulled out.`);
  if (owner === state.playerId) pushFeed(state, 'important', 'They took your terms and are pulling out.', null, networkOf(state, owner), b.id);
  return null;
}

/** After a win: execute the prisoners. Fear rises, calentura spikes, and families turn against you. */
export function executePrisoners(ctx: SimContext, b: Battle, owner: Id): string | null {
  const { state, content } = ctx;
  const t = content.tuning.battle.executePrisoners;
  const net = networkOf(state, owner);
  if (b.endedAt === null) return 'the fight is not over';
  if (state.hour - b.endedAt > t.windowHours) return 'the prisoners are long gone';
  const k = sideOfOwner(state, b, owner);
  if (!k || b.winner !== k) return 'only the winners hold prisoners';
  if (b.prisonersExecuted || !(b.prisoners[net] ?? 0)) return 'you hold no prisoners from this fight';
  b.prisonersExecuted = true;
  const me = state.characters[owner]!;
  me.fear = Math.min(100, me.fear + t.fear);
  const region = state.regions[b.region];
  if (region) region.calentura = Math.min(100, region.calentura + t.calentura);
  const w = world(content);
  for (const n of Object.keys(state.nodes).sort()) if (w.node(n).region === b.region) state.nodes[n]!.support = Math.max(0, state.nodes[n]!.support - t.supportLoss);
  pushFeed(state, 'critical', `${charName(ctx, owner)}'s people executed ${b.prisoners[net]} prisoners. The region will not forget it.`, b.where.kind === 'node' ? b.where.node : null, null, b.id);
  return null;
}

/** AI owners pick a stance at each decision point. */
export function aiStance(state: GameState, content: Content, b: Battle, owner: Id): Stance {
  const t = content.tuning.battle.ai;
  const k = sideOfOwner(state, b, owner);
  if (!k) return 'hold';
  const ratio = b[k].power / Math.max(1, b[other(k)].power);
  if (ratio >= t.assaultRatio) return 'assault';
  if (ratio <= t.holdRatio) return 'hold';
  if (stanceBlocked(state, content, b, owner, 'flank') === null && chance(state.rng, t.flankChance)) return 'flank';
  return b[k].helpCalled ? 'hold' : 'assault';
}
