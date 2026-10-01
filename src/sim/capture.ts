/**
 * Capturing bosses (GDD "Capturing bosses"): the capture roll when a boss's
 * crew loses, and what the captor does with him. The captor decides, AI
 * captors by personality; the player decides from the Captives list. This
 * replaces the old automatic seven-day ransom, which survives only as the
 * buy-out after `maxHoldDays` for captives nobody decides about.
 */
import type { Content } from '../data/content';
import { newId, pushFeed, type SimContext } from './context';
import { declare } from './diplomacy';
import { deposit, spendUpTo } from './money';
import { networkOf } from './network';
import { addOpinion, opinionOf } from './opinion';
import { charName } from './orders';
import { chance } from './rng';
import type { Battle, CrewState, GameState, Id } from './state';
import { killCharacter } from './systems/characters';
import { world } from './world';

export type CaptureSituation = 'destroyed' | 'routed' | 'fellBack' | 'withdrew';

export type CaptiveOption = 'ransom' | 'trade' | 'interrogate' | 'turn' | 'leverage' | 'hand_over' | 'execute' | 'release';

export const CAPTIVE_OPTIONS: CaptiveOption[] = ['ransom', 'trade', 'interrogate', 'turn', 'leverage', 'hand_over', 'execute', 'release'];

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Chance the leader of a losing crew is taken. */
export function captureChance(state: GameState, content: Content, b: Battle, crew: CrewState, losers: number, winners: number, situation: CaptureSituation): number {
  const t = content.tuning.capture;
  const leader = state.characters[crew.leader];
  if (!leader) return 0;
  const ratio = winners / Math.max(1, losers);
  let p = (t.rankBase[leader.rank] ?? 0.3) * Math.max(t.ratioMin, Math.min(t.ratioMax, ratio / t.ratioDivisor));
  if (b.approaches.length >= 2) p *= t.encircledMultiplier;
  for (const tr of leader.traits) p *= t.traitMultiplier[tr] ?? 1;
  const terrain = b.where.kind === 'road' ? 'road' : world(content).node(b.where.node).type;
  p *= t.terrainMultiplier[terrain] ?? 1;
  p *= t.situation[situation];
  return Math.min(t.max, Math.max(0, p));
}

/** Ransom asked for a captive, by rank. */
export function ransomFor(content: Content, state: GameState, id: Id): number {
  const ch = state.characters[id];
  return ch ? (content.tuning.capture.ransomByRank[ch.rank] ?? 50000) : 0;
}

/** Why `captor` cannot do `option` with `captive`, or null. */
export function captiveBlocked(state: GameState, content: Content, captor: Id, captive: Id, option: CaptiveOption, trade?: Id | null): string | null {
  const ch = state.characters[captive];
  if (!ch || ch.status !== 'captured' || ch.captor !== captor) return 'you are not holding him';
  const me = state.characters[captor]!;
  const t = content.tuning.capture;
  switch (option) {
    case 'trade': {
      const mine = trade ? state.characters[trade] : undefined;
      if (!mine || mine.status !== 'captured') return 'pick one of your people they hold';
      if (networkOf(state, trade!) !== networkOf(state, captor)) return 'he is not one of yours';
      if (!mine.captor || networkOf(state, mine.captor) !== networkOf(state, captive)) return 'his side is not the one holding him';
      return null;
    }
    case 'interrogate':
      return ch.interrogated >= t.interrogate.maxSessions ? 'he has nothing more to give' : null;
    case 'turn':
      if (me.faction === null) return 'a neutral has no side to bring him to';
      if (ch.faction === me.faction) return 'he is already on your side';
      if (ch.outsider !== null) return 'an outside cartel is bought, not turned';
      if (ch.faction !== null && state.factions[ch.faction]?.head === captive) return 'a faction head will not switch sides';
      return null;
    case 'leverage': {
      const head = ch.faction ? state.factions[ch.faction]?.head : null;
      if (!head || head === captive || state.characters[head]?.status !== 'free') return 'there is no one on his side to press';
      return null;
    }
    default:
      return null;
  }
}

/** The captor's choice. */
export function decideCaptive(ctx: SimContext, captor: Id, captive: Id, option: CaptiveOption, trade: Id | null = null): string | null {
  const { state, content } = ctx;
  const blocked = captiveBlocked(state, content, captor, captive, option, trade);
  if (blocked) return blocked;
  const t = content.tuning.capture;
  const ch = state.characters[captive]!;
  const me = state.characters[captor]!;
  const who = charName(ctx, captive);
  const by = charName(ctx, captor);
  const home = ch.homePlaza;
  switch (option) {
    case 'ransom': {
      const asked = ransomFor(content, state, captive);
      let paid = spendUpTo(state, content, captive, asked, 'ransom');
      const head = ch.faction ? state.factions[ch.faction]?.head : null;
      if (paid < asked && head && head !== captive && state.characters[head]?.status === 'free') paid += spendUpTo(state, content, head, asked - paid, 'ransom');
      if (paid > 0) deposit(state, content, captor, paid, 'ransom');
      free(ctx, captive);
      addOpinion(state, content, captive, captor, 'held_me_for_ransom', t.ransomGrudge, content.tuning.events.opinionDecayDays);
      pushFeed(state, 'important', `${who} was released for a ransom of ${money(paid)}.`, home, null);
      return null;
    }
    case 'trade': {
      free(ctx, captive);
      free(ctx, trade!);
      pushFeed(state, 'important', `${by} traded ${who} for ${charName(ctx, trade!)}.`, home, null);
      return null;
    }
    case 'interrogate': {
      ch.interrogated += 1;
      ch.health = Math.max(0, ch.health - t.interrogate.healthLoss);
      revealSecrets(ctx, captor, captive);
      for (const r of ch.relations) if (['parent', 'child', 'sibling', 'spouse'].includes(r.type)) addOpinion(state, content, r.target, captor, 'tortured_family', t.interrogate.familyOpinion, content.tuning.events.opinionDecayDays);
      if (ch.health <= 0) {
        killCharacter(ctx, captive);
        pushFeed(state, 'critical', `${who} died under questioning.`, home, null);
      }
      return null;
    }
    case 'turn': {
      const head = ch.faction ? state.factions[ch.faction]?.head : null;
      const resents = head ? opinionOf(state, content, captive, head) < t.turn.resentBelow : true;
      const p = t.turn.base + t.turn.perPalabra * me.skills.palabra + (resents ? t.turn.resentBonus : 0);
      if (!chance(state.rng, Math.min(0.95, p))) {
        addOpinion(state, content, captive, captor, 'tried_to_turn_me', t.turn.failOpinion, content.tuning.events.opinionDecayDays);
        if (captor === state.playerId) pushFeed(state, 'important', `${who} would not turn.`, home, networkOf(state, captor));
        return null;
      }
      free(ctx, captive);
      declare(ctx, captive, me.faction);
      if (ch.rank === 'head' || ch.rank === 'inner_circle') ch.rank = 'senior_lieutenant';
      pushFeed(state, 'critical', `${who} now works for ${by}'s side.`, home, null);
      return null;
    }
    case 'leverage': {
      const head = state.factions[ch.faction!]!.head!;
      const region = home ? world(content).node(home).region : (Object.keys(state.regions).sort()[0] ?? '');
      const parties: [Id, Id] = captor < head ? [captor, head] : [head, captor];
      state.pacts.push({ id: newId(state, 'pact'), type: 'local_truce', parties, secret: false, expiresAt: state.hour + t.leverageDays * 24, region, createdAt: state.hour });
      pushFeed(state, 'important', `Holding ${who}, ${by} forced a truce from ${charName(ctx, head)} in ${state.regions[region] ? (content.regions.find((r) => r.id === region)?.name ?? region) : region}.`, home, null);
      return null;
    }
    case 'hand_over': {
      ch.status = 'jailed';
      ch.statusSince = state.hour;
      ch.captor = null;
      for (const r of regionsOf(state, content, captor)) state.regions[r]!.calentura = Math.max(0, state.regions[r]!.calentura - t.handOver.calenturaDrop);
      me.respect -= t.handOver.respectLoss;
      me.stateIntel = Math.max(0, me.stateIntel - t.handOver.stateIntelDrop);
      pushFeed(state, 'critical', `${by} handed ${who} to the authorities. Other narcos call it snitching.`, home, null);
      return null;
    }
    case 'execute': {
      killCharacter(ctx, captive);
      me.fear = Math.min(100, me.fear + t.execute.fear);
      const region = home ? world(content).node(home).region : null;
      if (region && state.regions[region]) state.regions[region]!.calentura = Math.min(100, state.regions[region]!.calentura + t.execute.calentura);
      for (const r of ch.relations) {
        const rel = state.characters[r.target];
        if (!rel || !['parent', 'child', 'sibling', 'spouse'].includes(r.type)) continue;
        if (!rel.relations.some((x) => x.type === 'vendetta' && x.target === captor)) rel.relations.push({ type: 'vendetta', target: captor });
      }
      pushFeed(state, 'critical', `${by} had ${who} executed. His family swears revenge.`, home, null);
      return null;
    }
    case 'release': {
      free(ctx, captive);
      addOpinion(state, content, captive, captor, 'spared_me', t.release.opinion, null);
      pushFeed(state, 'important', `${by} let ${who} go. He owes him his life.`, home, null);
      return null;
    }
  }
}

function free(ctx: SimContext, id: Id): void {
  const ch = ctx.state.characters[id];
  if (!ch) return;
  ch.status = 'free';
  ch.statusSince = ctx.state.hour;
  ch.captor = null;
}

function regionsOf(state: GameState, content: Content, id: Id): Id[] {
  const w = world(content);
  return [...new Set(Object.keys(state.nodes).filter((n) => state.nodes[n]!.owner === id).map((n) => w.node(n).region))].filter((r) => state.regions[r]).sort();
}

/** Under questioning he gives up his side's garrisons and its plans. */
function revealSecrets(ctx: SimContext, captor: Id, captive: Id): void {
  const { state, content } = ctx;
  const net = networkOf(state, captor);
  const theirs = networkOf(state, captive);
  for (const c of Object.values(state.crews).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (networkOf(state, c.owner) !== theirs || c.location.kind !== 'node') continue;
    state.reports.push({ id: newId(state, 'rep'), network: net, crew: c.id, owner: c.owner, men: c.men, low: c.men, high: c.men, vehicles: {}, where: structuredClone(c.location), roadType: null, hour: state.hour, confidence: 'confirmed', source: 'informant', planted: false });
  }
  const f = state.characters[captive]!.faction;
  const plan = f ? state.factions[f]?.warPlan : null;
  const target = plan?.target ? world(content).node(plan.target).name : null;
  if (captor === state.playerId) {
    pushFeed(state, 'critical', `Under questioning ${charName(ctx, captive)} gave up where his side's crews sit${target ? `, and that they mean to hit ${target}` : ''}.`, null, net);
  }
}

/** Daily: AI captors decide; captives nobody decides about are bought out. */
export function runCaptivesDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.capture;
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (ch.status !== 'captured' || !ch.captor) continue;
    const captor = ch.captor;
    const held = state.hour - ch.statusSince;
    const ai = captor !== state.playerId || state.autoplay;
    if (ai && held >= t.aiDecideHours) {
      const choice = aiChoice(state, content, captor, id);
      if (decideCaptive(ctx, captor, id, choice.option, choice.trade) === null) continue;
    }
    if (held >= t.maxHoldDays * 24) decideCaptive(ctx, captor, id, 'ransom');
  }
}

/** AI captors choose by personality (a Sanguinario executes, a Codicioso ransoms). */
export function aiChoice(state: GameState, content: Content, captor: Id, captive: Id): { option: CaptiveOption; trade: Id | null } {
  const me = state.characters[captor]!;
  const ch = state.characters[captive]!;
  const has = (tr: string) => me.traits.includes(tr);
  const ok = (o: CaptiveOption, trade: Id | null = null) => captiveBlocked(state, content, captor, captive, o, trade) === null;
  // Get our own people back first.
  const ours = Object.values(state.characters)
    .filter((c) => c.status === 'captured' && c.captor && networkOf(state, c.id) === networkOf(state, captor) && networkOf(state, c.captor) === networkOf(state, captive))
    .map((c) => c.id)
    .sort()[0];
  if (ours && ok('trade', ours)) return { option: 'trade', trade: ours };
  if (has('sanguinario') || has('vengativo')) return { option: 'execute', trade: null };
  const head = ch.faction ? state.factions[ch.faction]?.head : null;
  if (ok('turn') && head && opinionOf(state, content, captive, head) < content.tuning.capture.turn.resentBelow) return { option: 'turn', trade: null };
  if (has('calculador') && ok('interrogate')) return { option: 'interrogate', trade: null };
  return { option: 'ransom', trade: null };
}
