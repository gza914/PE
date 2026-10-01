/**
 * Schemes (GDD "Characters": Schemes). A scheme runs over days: it makes daily
 * progress from the schemer's skill and rolls daily for discovery against the
 * target's Astucia (raised by traits like Paranoico, "schemeDefense"; Calculador
 * schemers progress faster, "schemePower"). Discovery ends it and
 * reveals the schemer. At 100 progress it succeeds or fails on a final roll.
 *
 * - flip: turn a rival lieutenant (Palabra; easier if he dislikes his boss)
 * - assassinate: kill a character (Astucia; harder against guards and paranoia)
 * - frame: make his own head and the State blame him (Astucia)
 * - leak_location: hand the army his position (Astucia; he may learn who)
 * - buy_halcones: take over a rival plaza's lookouts (Negocio)
 * - compadrazgo: build a lasting bond (Palabra)
 */
import type { SchemeType } from '../../data/schemas';
import { newId, pushFeed, tellSide, type SimContext } from '../context';
import { declare } from '../diplomacy';
import { spend } from '../money';
import { networkOf } from '../network';
import { addOpinion, opinionOf } from '../opinion';
import { charName } from '../orders';
import { chance, rand } from '../rng';
import type { Id, Scheme } from '../state';
import { isAi } from '../ai/util';
import { traitProduct } from '../traits';
import { world } from '../world';
import { killCharacter } from './characters';
import { raidPlaza } from './stateForces';
import { isGone } from '../state';

export const SCHEME_LABEL: Record<SchemeType, string> = {
  flip: 'Flip a lieutenant',
  assassinate: 'Assassinate',
  frame: 'Frame',
  leak_location: 'Leak a location',
  buy_halcones: 'Buy their halcones',
  compadrazgo: 'Compadrazgo',
};

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** The character a scheme works against (the plaza's owner for buy_halcones). */
export function schemeVictim(state: SimContext['state'], s: Pick<Scheme, 'type' | 'target'>): Id | null {
  if (s.type === 'buy_halcones') return state.nodes[s.target]?.owner ?? null;
  return state.characters[s.target] ? s.target : null;
}

function targetName(ctx: SimContext, s: Pick<Scheme, 'type' | 'target'>): string {
  return s.type === 'buy_halcones' ? `the halcones of ${world(ctx.content).node(s.target).name}` : charName(ctx, s.target);
}

/** Why this scheme cannot start, or null. */
export function schemeBlocked(ctx: SimContext, owner: Id, type: SchemeType, target: Id): string | null {
  const { state, content } = ctx;
  const me = state.characters[owner];
  if (!me) return 'unknown schemer';
  const net = networkOf(state, owner);
  const active = state.schemes.filter((s) => s.owner === owner);
  if (active.length >= content.tuning.schemes.maxActive) return `you can run at most ${content.tuning.schemes.maxActive} schemes at once`;
  if (active.some((s) => s.type === type && s.target === target)) return 'that scheme is already running';
  if (type === 'buy_halcones') {
    const p = state.nodes[target];
    if (!p?.owner) return 'no one holds that plaza';
    if (networkOf(state, p.owner) === net) return 'those halcones are already your side’s';
    if (p.halconCoverage <= 0) return 'that plaza has no halcones to buy';
    return null;
  }
  const t = state.characters[target];
  if (!t || t.status !== 'free' || target === owner) return 'pick someone free to act against';
  const rival = networkOf(state, target) !== net;
  switch (type) {
    case 'flip':
      if (!me.faction) return 'a neutral has no side to bring him to';
      if (!rival || t.faction === null) return 'flip a lieutenant from the other side';
      if (state.factions[t.faction]?.head === target) return 'a faction head will not switch sides';
      if (t.outsider !== null) return 'an outside cartel is bought, not flipped';
      return null;
    case 'assassinate':
    case 'frame':
    case 'leak_location':
      return rival ? null : 'not against your own side';
    case 'compadrazgo':
      return me.relations.some((r) => r.type === 'compadre' && r.target === target) ? 'you are already compadres' : null;
  }
  return null;
}

export function startScheme(ctx: SimContext, owner: Id, type: SchemeType, target: Id): string | null {
  const { state, content } = ctx;
  const blocked = schemeBlocked(ctx, owner, type, target);
  if (blocked) return blocked;
  const cost = content.tuning.schemes.types[type].cost;
  if (!spend(state, content, owner, cost, 'schemes')) return `this scheme needs $${cost.toLocaleString()} up front`;
  state.schemes.push({ id: newId(state, 'scheme'), type, owner, target, progress: 0, startedAt: state.hour, discovered: false });
  return null;
}

export function cancelScheme(ctx: SimContext, owner: Id, id: Id): string | null {
  const s = ctx.state.schemes.find((x) => x.id === id);
  if (!s || s.owner !== owner) return 'no such scheme of yours';
  ctx.state.schemes = ctx.state.schemes.filter((x) => x !== s);
  return null;
}

/** Runs once per day. */
export function runSchemesDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.schemes;
  noticeBoughtHalcones(ctx);
  if (!t.enabled) return;
  const done = new Set<Id>();
  for (const s of [...state.schemes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const owner = state.characters[s.owner];
    const victim = schemeVictim(state, s);
    const tv = victim ? state.characters[victim] : undefined;
    if (!owner || isGone(owner.status) || !tv || isGone(tv.status) || (s.type !== 'buy_halcones' && tv.status !== 'free')) {
      done.add(s.id);
      continue;
    }
    if (owner.status !== 'free') continue;
    const k = t.types[s.type];
    s.progress = clamp(s.progress + (k.base + owner.skills[k.skill] * k.perSkill) * traitProduct(state, content, owner.id, 'schemePower'));
    const discovery = (k.discoveryBase + tv.skills.astucia * k.discoveryPerAstucia) * traitProduct(state, content, tv.id, 'schemeDefense');
    if (discovery > 0 && chance(state.rng, discovery)) {
      discovered(ctx, s, tv.id);
      done.add(s.id);
      continue;
    }
    if (s.progress >= 100) {
      complete(ctx, s, tv.id);
      done.add(s.id);
    }
  }
  state.schemes = state.schemes.filter((s) => !done.has(s.id));
}

function discovered(ctx: SimContext, s: Scheme, victim: Id): void {
  const { state, content } = ctx;
  s.discovered = true;
  addOpinion(state, content, victim, s.owner, `schemed_${s.type}`, content.tuning.schemes.discoveredOpinion, content.tuning.events.opinionDecayDays);
  const what = SCHEME_LABEL[s.type].toLowerCase();
  pushFeed(state, 'critical', `${charName(ctx, victim)} uncovered a plot against them (${what}): ${charName(ctx, s.owner)} was behind it.`, null, networkOf(state, victim));
  tellSide(state, s.owner, 'critical', `Your scheme against ${targetName(ctx, s)} was discovered.`, (n) => `${n}'s scheme against ${targetName(ctx, s)} was discovered.`);
}

function complete(ctx: SimContext, s: Scheme, victim: Id): void {
  const { state, content } = ctx;
  const t = content.tuning.schemes;
  const k = t.types[s.type];
  const owner = state.characters[s.owner]!;
  const tv = state.characters[victim]!;
  let p = k.successBase + owner.skills[k.skill] * k.successPerSkill;
  if (s.type === 'flip') {
    const head = tv.faction ? state.factions[tv.faction]?.head : null;
    if (head) p -= opinionOf(state, content, tv.id, head) * t.flipOpinionWeight;
    p += opinionOf(state, content, tv.id, s.owner) * t.flipOpinionWeight;
  }
  if (s.type === 'assassinate') {
    const guards = tv.homePlaza ? Object.values(state.crews).filter((c) => c.owner === tv.id && c.location.kind === 'node' && c.location.node === tv.homePlaza).length : 0;
    p -= guards * t.assassinateSecurityPerCrew;
    if (tv.traits.includes('paranoico')) p -= t.assassinateParanoicoPenalty;
  }
  const ok = rand(state.rng) < Math.max(0, Math.min(1, p));
  const mine = networkOf(state, s.owner);
  // Scheme results are the schemer's news; teammates hear about them only when it is the player's scheme.
  const say = (text: string) => {
    if (s.owner === state.playerId) pushFeed(state, 'important', text, null, mine);
  };
  if (!ok) {
    say(`Your scheme against ${targetName(ctx, s)} came to nothing.`);
    if (s.type === 'assassinate' || s.type === 'flip') discovered(ctx, s, victim);
    return;
  }
  switch (s.type) {
    case 'flip':
      if (owner.faction) {
        pushFeed(state, 'critical', `${charName(ctx, victim)} has switched sides, bringing his plazas and men to ${charName(ctx, s.owner)}.`, tv.homePlaza, null);
        declare(ctx, victim, owner.faction);
      }
      break;
    case 'assassinate':
      pushFeed(state, 'critical', `${charName(ctx, victim)} was shot dead outside his house. No one has claimed it.`, tv.homePlaza, null);
      killCharacter(ctx, victim);
      break;
    case 'frame': {
      const head = tv.faction ? state.factions[tv.faction]?.head : null;
      if (head && head !== victim) addOpinion(state, content, head, victim, 'blamed_for_a_disaster', t.frameOpinion, content.tuning.events.opinionDecayDays);
      tv.stateIntel = clamp(tv.stateIntel + t.frameStateIntel);
      say(`${charName(ctx, victim)} is taking the blame. His own people and the State are looking at him now.`);
      break;
    }
    case 'leak_location': {
      tv.stateIntel = clamp(tv.stateIntel + t.leakStateIntel);
      const home = tv.homePlaza && state.nodes[tv.homePlaza]?.owner === victim ? state.nodes[tv.homePlaza]! : null;
      if (home && (home.labs > 0 || home.stash >= content.tuning.state.raids.stashMin)) raidPlaza(ctx, home.id, home.labs > 0 ? 'lab' : 'stash');
      say(`The army now knows where ${charName(ctx, victim)} sleeps.`);
      break;
    }
    case 'buy_halcones':
      state.nodes[s.target]!.halconesBoughtBy = mine;
      say(`The halcones of ${world(content).node(s.target).name} now report to you.`);
      break;
    case 'compadrazgo':
      for (const [a, b] of [
        [s.owner, victim],
        [victim, s.owner],
      ] as const) {
        const ch = state.characters[a]!;
        if (!ch.relations.some((r) => r.type === 'compadre' && r.target === b)) ch.relations.push({ type: 'compadre', target: b });
        addOpinion(state, content, a, b, 'compadres', t.compadrazgoOpinion, null);
      }
      pushFeed(state, 'important', `${charName(ctx, s.owner)} and ${charName(ctx, victim)} are compadres now.`, null, null);
      break;
  }
}

/**
 * Bought halcones stop working for the buyer when the plaza changes hands,
 * and AI owners notice and buy them back. (The player learns through the
 * halcones_bought event.)
 */
function noticeBoughtHalcones(ctx: SimContext): void {
  const { state, content } = ctx;
  for (const id of Object.keys(state.nodes).sort()) {
    const p = state.nodes[id]!;
    if (!p.halconesBoughtBy) continue;
    if (!p.owner || networkOf(state, p.owner) === p.halconesBoughtBy) {
      p.halconesBoughtBy = null;
      continue;
    }
    if (!isAi(state, p.owner)) continue;
    const t = content.tuning.schemes.halconNotice;
    const astucia = state.characters[p.owner]!.skills.astucia;
    if (chance(state.rng, t.base + astucia * t.perAstucia)) {
      p.halconesBoughtBy = null;
      spend(state, content, p.owner, t.buyBackCost, 'halcones');
    }
  }
}
