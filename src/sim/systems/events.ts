/**
 * Paradox-style events (GDD "Event system"). Every event instance has:
 *
 * - a scope: the plaza, region, faction, or character it is about;
 * - a decider: the character who picks an option and bears its personal
 *   effects (money, fear, respect, credibility, profile, state intel, health).
 *   Plaza events go to the plaza's owner, region events to each character
 *   holding plazas there, faction events to each member, and character events
 *   to the character themselves or, for `decided_by: "boss"`, their superior;
 * - an other character, if any: the scope character when the boss decides,
 *   or a counterpart picked on firing (an ally, a rival lieutenant, a
 *   relative). Opinion, kill, promote, and release effects aim at them.
 *
 * Events fire three ways: daily mean-time-to-happen rolls, scheduled
 * follow-ups from other events, and systems (the State, rumors) firing them by
 * id. AI deciders pick by option weight at once; the player gets a pending
 * event and a critical notice, and after a while an unanswered event resolves
 * with the advisor's pick.
 */
import type { Content } from '../../data/content';
import type { GameEvent } from '../../data/schemas';
import { dayOf } from '../clock';
import { newId, pushFeed, type SimContext } from '../context';
import { declare } from '../diplomacy';
import { cashOf, deposit, seizeStash, spendUpTo } from '../money';
import { networkOf } from '../network';
import { addOpinion } from '../opinion';
import { charName } from '../orders';
import { addTruce, breakTruces } from '../pacts';
import { chance, rand } from '../rng';
import type { CrewState, GameState, Id, PendingEvent, PlazaState } from '../state';
import { newTransit } from '../newGame';
import { cautionOf, isAi, majorFactions } from '../ai/util';
import { world } from '../world';
import { killCharacter } from './characters';
import { characterTerritory } from './economy';
import { jailBreakout, jailBribe, militaryClash, resolveCapture, tierOf, TIERS } from './stateForces';
import { plantRumor } from './infowar';

export interface Instance {
  def: GameEvent;
  scope: Id;
  decider: Id;
  other: Id | null;
}

type Conditions = GameEvent['trigger'];
type Effects = GameEvent['options'][number]['effects'];

const RELATIVES = new Set(['parent', 'child', 'sibling', 'spouse']);
const MONEY_COSTS: (keyof Effects)[] = ['money'];

export function eventDef(content: Content, id: Id): GameEvent | undefined {
  return content.events.find((e) => e.id === id);
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

/** The character the event's character conditions look at. */
function subjectOf(inst: Instance): Id {
  return inst.def.scope === 'character' ? inst.scope : inst.decider;
}

function homePlaza(state: GameState, id: Id): PlazaState | null {
  const ch = state.characters[id];
  if (!ch) return null;
  if (ch.homePlaza && state.nodes[ch.homePlaza]?.owner === id) return state.nodes[ch.homePlaza]!;
  return (
    Object.values(state.nodes)
      .filter((n) => n.owner === id)
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? null
  );
}

/** Region a character calls home: their home plaza's, else their first plaza's. */
export function homeRegion(state: GameState, content: Content, id: Id): Id | null {
  const ch = state.characters[id];
  if (!ch) return null;
  const w = world(content);
  if (ch.homePlaza) return w.node(ch.homePlaza).region;
  const p = homePlaza(state, id);
  return p ? w.node(p.id).region : null;
}

export function scopeRegion(ctx: SimContext, inst: Instance): Id | null {
  const { state, content } = ctx;
  switch (inst.def.scope) {
    case 'plaza':
      return world(content).node(inst.scope).region;
    case 'region':
      return inst.scope;
    case 'character':
      return homeRegion(state, content, inst.scope) ?? homeRegion(state, content, inst.decider);
    case 'faction':
      return homeRegion(state, content, inst.decider);
  }
}

/** Plazas the event's plaza effects touch. */
function scopePlazas(ctx: SimContext, inst: Instance): PlazaState[] {
  const { state, content } = ctx;
  if (inst.def.scope === 'plaza') return state.nodes[inst.scope] ? [state.nodes[inst.scope]!] : [];
  if (inst.def.scope === 'region') {
    const w = world(content);
    return Object.values(state.nodes)
      .filter((n) => n.owner === inst.decider && w.node(n.id).region === inst.scope)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  const home = homePlaza(state, inst.decider);
  return home ? [home] : [];
}

/** Who a character answers to: the owner of a crew they lead, else their faction head. */
export function bossOf(state: GameState, id: Id): Id | null {
  const ch = state.characters[id];
  if (!ch) return null;
  if (ch.rank === 'crew_leader') {
    const owner = Object.values(state.crews)
      .filter((c) => c.leader === id && c.owner !== id)
      .map((c) => c.owner)
      .sort()[0];
    if (owner) return owner;
  }
  const head = ch.faction ? state.factions[ch.faction]?.head : null;
  return head && head !== id ? head : null;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export function conditionsMet(ctx: SimContext, cond: Conditions | undefined, inst: Instance): boolean {
  if (!cond) return true;
  for (const key of Object.keys(cond).sort() as (keyof Conditions)[]) {
    if (!check(ctx, key, cond[key], inst)) return false;
  }
  return true;
}

function check(ctx: SimContext, key: keyof Conditions, v: unknown, inst: Instance): boolean {
  const { state, content } = ctx;
  const t = content.tuning.events;
  const subject = state.characters[subjectOf(inst)];
  const decider = state.characters[inst.decider];
  if (!subject || !decider) return false;
  const plaza = inst.def.scope === 'plaza' ? state.nodes[inst.scope] : undefined;
  const plazas = scopePlazas(ctx, inst);
  const regionId = scopeRegion(ctx, inst);
  const region = regionId ? state.regions[regionId] : undefined;
  const faction = decider.faction ? state.factions[decider.faction] : undefined;
  const num = v as number;
  const flag = v as boolean;
  switch (key) {
    case 'is_player':
      return (subject.id === state.playerId) === flag;
    case 'owner_is_player':
      return ((plaza ? plaza.owner : inst.decider) === state.playerId) === flag;
    case 'decider_neutral':
      return (decider.faction === null) === flag;
    case 'decider_aligned':
      return (decider.faction !== null) === flag;
    case 'has_foreign_ally':
      return (decider.foreignAlly !== null) === flag;
    case 'labs_gt':
      return plazas.reduce((n, p) => n + p.labs, 0) > num;
    case 'businesses_gt':
      return plazas.reduce((n, p) => n + p.businesses, 0) > num;
    case 'support_gt':
    case 'support_lt': {
      if (!plazas.length) return false;
      const s = plazas.reduce((n, p) => n + p.support, 0) / plazas.length;
      return key === 'support_gt' ? s > num : s < num;
    }
    case 'calentura_gt':
      return (region?.calentura ?? 0) > num;
    case 'calentura_lt':
      return (region?.calentura ?? 0) < num;
    case 'military_presence_gt':
      return (plaza ? plaza.militaryPresence : region ? TIERS.indexOf(tierOf(content, region.calentura)) : 0) > num;
    case 'combat_hours_gt': {
      const h = plaza ? plaza.combatHoursWeek + plaza.combatHoursToday : region ? region.combatHoursWeek + region.combatHoursToday : 0;
      return h > num;
    }
    case 'exhaustion_gt': {
      const e = faction ? faction.exhaustion : Math.max(0, ...majorFactions(content).map((f) => state.factions[f]?.exhaustion ?? 0));
      return e > num;
    }
    case 'supply_lt':
      return !!faction && faction.supply < num;
    case 'profile_gt':
      return subject.profile > num;
    case 'respect_gt':
      return subject.respect > num;
    case 'cash_gt':
      return cashOf(state, decider.id) > num;
    case 'cash_lt':
      return cashOf(state, decider.id) < num;
    case 'age_gt':
      return subject.age > num;
    case 'day_gt':
      return dayOf(state.hour) > num;
    case 'day_lt':
      return dayOf(state.hour) < num;
    case 'days_since_bribe_gt':
      return (
        !!region &&
        region.commanderBribedBy === networkOf(state, decider.id) &&
        region.commanderBribedAt !== null &&
        (state.hour - region.commanderBribedAt) / 24 > num
      );
    case 'has_trait':
      return subject.traits.includes(v as string);
    case 'rank_is':
      return subject.rank === v;
    case 'node_type':
      return !!plaza && world(content).node(plaza.id).type === v;
    case 'extortion_rate_is':
      return !!plaza && plaza.extortionRate === v;
    case 'family_member_died':
      return (
        subject.relations.some((r) => {
          if (!RELATIVES.has(r.type)) return false;
          const rel = state.characters[r.target];
          return !!rel && rel.status === 'dead' && state.hour - rel.statusSince <= t.familyDeathWindowDays * 24;
        }) === flag
      );
    case 'jailed':
      return (subject.status === 'jailed') === flag;
    case 'losing_ground':
      return (decider.baseTerritory > 0 && characterTerritory(state, content, decider.id) < decider.baseTerritory * t.losingGroundShare) === flag;
    case 'missed_payroll':
      return (decider.missedPayrollWeeks > 0) === flag;
    case 'halcones_bought':
      return (!!plaza && plaza.halconesBoughtBy !== null) === flag;
    case 'battle_in_populated_node': {
      if (!plaza) return false;
      const type = world(content).node(plaza.id).type;
      const populated = type === 'city' || type === 'town' || type === 'port';
      const recent = plaza.lastBattleAt !== null && state.hour - plaza.lastBattleAt <= t.populatedBattleDays * 24;
      return (populated && recent) === flag;
    }
    case 'cash_on_road':
      return (decider.lastCashMoveAt !== null && state.hour - decider.lastCashMoveAt <= t.cashOnRoadHours) === flag;
    case 'commissioned_corrido':
      return (decider.corridoUntil !== null) === flag;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

interface Candidate {
  scope: Id;
  decider: Id;
  other: Id | null;
}

function free(state: GameState, id: Id | null | undefined): id is Id {
  // Outside cartels' bosses are not part of anyone's story here.
  return !!id && state.characters[id]?.status === 'free' && state.characters[id]?.outsider === null;
}

/** Every (scope, decider) pair an event could fire for, in a fixed order. */
function candidates(ctx: SimContext, def: GameEvent): Candidate[] {
  const { state, content } = ctx;
  const w = world(content);
  const out: Candidate[] = [];
  switch (def.scope) {
    case 'plaza':
      for (const id of Object.keys(state.nodes).sort()) {
        const owner = state.nodes[id]!.owner;
        if (free(state, owner) && w.node(id).type !== 'border_exit') out.push({ scope: id, decider: owner, other: null });
      }
      break;
    case 'region':
      for (const r of Object.keys(state.regions).sort()) {
        const owners = new Set<Id>();
        for (const n of Object.values(state.nodes)) if (n.owner && w.node(n.id).region === r) owners.add(n.owner);
        for (const o of [...owners].sort()) if (free(state, o)) out.push({ scope: r, decider: o, other: null });
      }
      break;
    case 'faction':
      for (const f of majorFactions(content)) {
        for (const id of Object.keys(state.characters).sort()) {
          if (state.characters[id]!.faction === f && free(state, id)) out.push({ scope: f, decider: id, other: null });
        }
      }
      break;
    case 'character':
      for (const id of Object.keys(state.characters).sort()) {
        const ch = state.characters[id]!;
        const jailedOk = def.trigger.jailed === true;
        if (!(ch.status === 'free' || (jailedOk && ch.status === 'jailed'))) continue;
        if (def.decided_by === 'boss') {
          const boss = bossOf(state, id);
          if (free(state, boss)) out.push({ scope: id, decider: boss, other: id });
        } else {
          out.push({ scope: id, decider: id, other: null });
        }
      }
      break;
  }
  return out;
}

function onCooldown(ctx: SimContext, def: GameEvent, c: Candidate): boolean {
  const { state, content } = ctx;
  const t = content.tuning.events;
  const repeat = t.repeatCooldownDays * 24;
  const chain = t.chainCooldownDays * 24;
  for (const e of state.eventLog) {
    const age = state.hour - e.hour;
    if (e.event === def.id && e.scope === c.scope && (def.once_per_scope || e.decider === c.decider) && age < repeat) return true;
    if (def.chain && e.chain === def.chain && e.decider === c.decider && age < chain) return true;
  }
  if (state.pendingEvents.some((p) => p.event === def.id && p.decider === c.decider)) return true;
  return state.eventBlocks.some((b) => b.event === def.id && b.scope === c.scope && b.until > state.hour);
}

function playerCapped(ctx: SimContext): boolean {
  const { state, content } = ctx;
  const week = state.hour - 7 * 24;
  const n = state.eventLog.filter((e) => e.mtth && e.decider === state.playerId && e.hour > week).length;
  return n >= content.tuning.events.playerWeeklyCap;
}

/** AI deciders answer only when the events layer is on; the player always gets their events. */
function mayDecide(ctx: SimContext, decider: Id): boolean {
  const { state, content } = ctx;
  return decider === state.playerId && !state.autoplay ? true : content.tuning.ai.layers.events;
}

function pickCounterpart(ctx: SimContext, def: GameEvent, decider: Id): Id | null | undefined {
  const { state } = ctx;
  const me = state.characters[decider]!;
  const ranks = new Set(['lieutenant', 'senior_lieutenant', 'inner_circle']);
  let pool: Id[] = [];
  switch (def.counterpart) {
    case undefined:
      return null;
    case 'ally':
      if (!me.faction) return undefined;
      pool = Object.values(state.characters)
        .filter((c) => c.id !== decider && c.faction === me.faction && c.outsider === null && c.status === 'free' && ranks.has(c.rank))
        .map((c) => c.id);
      break;
    case 'rival_lieutenant':
      if (!me.faction) return undefined;
      pool = Object.values(state.characters)
        .filter((c) => c.faction !== null && c.outsider === null && c.faction !== me.faction && c.status === 'free' && ranks.has(c.rank) && state.factions[c.faction]?.head !== c.id)
        .map((c) => c.id);
      break;
    case 'relative':
      pool = me.relations.filter((r) => RELATIVES.has(r.type) && state.characters[r.target]?.status === 'free').map((r) => r.target);
      if (!pool.length) return null;
      break;
  }
  pool.sort();
  if (!pool.length) return undefined;
  return pool[Math.floor(rand(state.rng) * pool.length)]!;
}

/**
 * Fires an event for a decider. Returns false if it could not (no
 * counterpart, or the decider's side does not take events right now).
 */
export function fireEvent(ctx: SimContext, def: GameEvent, scope: Id, decider: Id, other: Id | null, mtth = false): boolean {
  const { state } = ctx;
  if (!state.characters[decider] || state.characters[decider]!.status === 'dead' || state.characters[decider]!.status === 'extradited') return false;
  if (!mayDecide(ctx, decider)) return false;
  if (other === null && def.scope === 'character' && def.counterpart) {
    const picked = pickCounterpart(ctx, def, decider);
    if (picked === undefined) return false;
    other = picked;
  }
  state.eventLog.push({ event: def.id, scope, decider, chain: def.chain ?? null, hour: state.hour, mtth });
  const inst: Instance = { def, scope, decider, other };
  if (isAi(state, decider) || (decider !== state.playerId && state.characters[decider]!.status !== 'free')) {
    applyOption(ctx, inst, aiPick(ctx, inst), false);
    return true;
  }
  const pe: PendingEvent = { instance: newId(state, 'ev'), event: def.id, scope, decider, other, firedAt: state.hour };
  state.pendingEvents.push(pe);
  pushFeed(state, 'critical', `${def.title}: a decision is waiting.`, eventNode(ctx, inst), null);
  return true;
}

/** Map node to jump to for an event, if any. */
export function eventNode(ctx: SimContext, inst: Instance): Id | null {
  if (inst.def.scope === 'plaza') return inst.scope;
  return homePlaza(ctx.state, inst.def.scope === 'character' ? inst.scope : inst.decider)?.id ?? ctx.state.characters[inst.decider]?.homePlaza ?? null;
}

/**
 * Fires an event by id for a decider (used by the State and rumors). It
 * respects the repeat cooldown unless `force` is set.
 */
export function fireById(ctx: SimContext, id: Id, scope: Id, decider: Id, other: Id | null = null, force = false): boolean {
  const def = eventDef(ctx.content, id);
  if (!def) return false;
  if (!force && onCooldown(ctx, def, { scope, decider, other })) return false;
  return fireEvent(ctx, def, scope, decider, other, false);
}

/** Queues an event to fire later. */
export function scheduleEvent(ctx: SimContext, event: Id, scope: Id, decider: Id, other: Id | null, at: number): void {
  ctx.state.scheduledEvents.push({ event, scope, decider, other, at });
}

/** Runs every hour: fires scheduled events that are due and auto-resolves stale player events. */
export function runScheduledEvents(ctx: SimContext): void {
  const { state, content } = ctx;
  if (!content.tuning.events.enabled) return;
  const due = state.scheduledEvents.filter((s) => s.at <= state.hour);
  if (due.length) {
    state.scheduledEvents = state.scheduledEvents.filter((s) => s.at > state.hour);
    for (const s of due) {
      const def = eventDef(content, s.event);
      if (!def) continue;
      const block = state.eventBlocks.find((b) => b.event === s.event && b.scope === s.scope && b.until > state.hour);
      if (block) {
        state.scheduledEvents.push({ ...s, at: block.until });
        continue;
      }
      // Plaza events go to whoever holds the plaza now.
      const decider = def.scope === 'plaza' ? state.nodes[s.scope]?.owner : s.decider;
      if (!free(state, decider) && !(def.trigger.jailed && state.characters[decider ?? '']?.status === 'jailed')) continue;
      const inst: Instance = { def, scope: s.scope, decider: decider!, other: s.other };
      if (!conditionsMet(ctx, def.trigger, inst)) continue;
      fireEvent(ctx, def, s.scope, decider!, s.other, false);
    }
  }
  const stale = content.tuning.events.autoResolveHours;
  for (const pe of [...state.pendingEvents]) {
    if (state.hour - pe.firedAt < stale) continue;
    const inst = instanceOf(ctx, pe);
    if (!inst) {
      state.pendingEvents = state.pendingEvents.filter((p) => p !== pe);
      continue;
    }
    const idx = aiPick(ctx, inst);
    state.pendingEvents = state.pendingEvents.filter((p) => p !== pe);
    pushFeed(state, 'important', `${inst.def.title}: with no word from you, your people chose "${inst.def.options[idx]!.label}".`, eventNode(ctx, inst), null);
    applyOption(ctx, inst, idx, false);
  }
}

/** Runs once per day: rolls mean-time-to-happen for every eligible event. */
export function runEventsDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.events;
  if (!t.enabled) return;
  state.eventLog = state.eventLog.filter((e) => state.hour - e.hour <= t.eventLogDays * 24);
  state.eventBlocks = state.eventBlocks.filter((b) => b.until > state.hour);
  for (const def of [...content.events].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (def.mean_days === undefined) continue;
    const p = 1 - Math.exp(-1 / (def.mean_days * t.meanDaysMultiplier));
    for (const c of candidates(ctx, def)) {
      if (!mayDecide(ctx, c.decider)) continue;
      if (c.decider === state.playerId && playerCapped(ctx)) continue;
      if (onCooldown(ctx, def, c)) continue;
      if (!conditionsMet(ctx, def.trigger, { def, ...c })) continue;
      if (!chance(state.rng, p)) continue;
      fireEvent(ctx, def, c.scope, c.decider, c.other, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

export function instanceOf(ctx: SimContext, pe: PendingEvent): Instance | null {
  const def = eventDef(ctx.content, pe.event);
  return def ? { def, scope: pe.scope, decider: pe.decider, other: pe.other } : null;
}

function cost(effects: Effects): number {
  return MONEY_COSTS.reduce((n, k) => n + Math.max(0, -((effects[k] as number | undefined) ?? 0)), 0);
}

/** Why an option cannot be taken right now, or null. */
export function optionBlocked(ctx: SimContext, inst: Instance, idx: number): string | null {
  const opt = inst.def.options[idx];
  if (!opt) return 'no such option';
  if (!conditionsMet(ctx, opt.conditions, inst)) return 'its conditions are not met';
  const c = cost(opt.effects) + (opt.effects.jail_bribe ? ctx.content.tuning.state.captureOps.jailBribeCost : 0);
  if (c > cashOf(ctx.state, inst.decider) + 1e-9) return `you need $${c.toLocaleString()}`;
  return null;
}

const RISKY: (keyof Effects)[] = ['start_military_clash', 'jail_breakout', 'kill_scope_character'];

/** The AI's (and the advisor's) choice: weighted by ai_weight, risky options discounted by caution. */
export function aiPick(ctx: SimContext, inst: Instance): number {
  const { state, content } = ctx;
  const caution = cautionOf(state, content, inst.decider);
  const weights = inst.def.options.map((o, i) => {
    if (optionBlocked(ctx, inst, i)) return 0;
    let w = o.ai_weight;
    if (RISKY.some((k) => o.effects[k]) || o.effects.resolve_capture === 'fight') w /= caution;
    return w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    const freeIdx = inst.def.options.findIndex((o) => cost(o.effects) === 0);
    return freeIdx >= 0 ? freeIdx : 0;
  }
  let r = rand(state.rng) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** The player answers a pending event (the choose_event_option command). */
export function chooseOption(ctx: SimContext, issuer: Id, instance: Id, idx: number): string | null {
  const { state } = ctx;
  const pe = state.pendingEvents.find((e) => e.instance === instance);
  if (!pe) return `no pending event "${instance}"`;
  if (pe.decider !== issuer) return 'that decision is not yours';
  const inst = instanceOf(ctx, pe);
  if (!inst) return 'unknown event';
  const blocked = optionBlocked(ctx, inst, idx);
  if (blocked) return blocked;
  state.pendingEvents = state.pendingEvents.filter((e) => e !== pe);
  applyOption(ctx, inst, idx, true);
  return null;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export function applyOption(ctx: SimContext, inst: Instance, idx: number, byPlayer: boolean): void {
  const opt = inst.def.options[idx];
  if (!opt) return;
  if (byPlayer || inst.decider === ctx.state.playerId) {
    pushFeed(ctx.state, 'routine', `${inst.def.title}: ${opt.label}.`, eventNode(ctx, inst), null);
  }
  applyEffects(ctx, inst, opt.effects);
}

function crewsOf(state: GameState, id: Id): CrewState[] {
  return Object.values(state.crews)
    .filter((c) => c.owner === id)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function rivalHeads(ctx: SimContext, of: Id): Id[] {
  const { state, content } = ctx;
  const net = networkOf(state, of);
  return majorFactions(content)
    .filter((f) => f !== net)
    .map((f) => state.factions[f]?.head)
    .filter((h): h is Id => !!h && state.characters[h]?.status !== 'dead' && state.characters[h]?.status !== 'extradited' && h !== of);
}

function ownHead(ctx: SimContext, of: Id): Id | null {
  const f = ctx.state.characters[of]?.faction;
  const h = f ? ctx.state.factions[f]?.head : null;
  return h && h !== of ? h : null;
}

const NEXT_RANK = { crew_leader: 'lieutenant', associate: 'lieutenant', lieutenant: 'senior_lieutenant', senior_lieutenant: 'inner_circle', inner_circle: 'inner_circle', head: 'head' } as const;

export function applyEffects(ctx: SimContext, inst: Instance, eff: Effects): void {
  const { state, content } = ctx;
  const decider = state.characters[inst.decider];
  if (!decider) return;
  const other = inst.other ? state.characters[inst.other] : undefined;
  const regionId = scopeRegion(ctx, inst);
  const region = regionId ? state.regions[regionId] : undefined;
  const plazas = scopePlazas(ctx, inst);
  const decay = content.tuning.events.opinionDecayDays;
  const key = inst.def.id;
  const opinion = (from: Id, to: Id, v: number) => {
    if (from !== to && state.characters[from]) addOpinion(state, content, from, to, key, v, decay);
  };

  if (eff.money !== undefined) {
    if (eff.money > 0) deposit(state, content, decider.id, eff.money, 'deals');
    else spendUpTo(state, content, decider.id, -eff.money, 'deals');
  }
  if (eff.calentura !== undefined && region) region.calentura = clamp(region.calentura + eff.calentura);
  if (eff.calentura_statewide !== undefined) for (const r of Object.values(state.regions)) r.calentura = clamp(r.calentura + eff.calentura_statewide);
  for (const p of plazas) {
    if (eff.support !== undefined) p.support = clamp(p.support + eff.support);
    if (eff.halcones !== undefined) p.halconCoverage = Math.round(clamp(p.halconCoverage + eff.halcones));
    if (eff.labs !== undefined) p.labs = Math.max(0, p.labs + eff.labs);
    if (eff.businesses_pct !== undefined) p.businesses = Math.max(0, p.businesses * (1 + eff.businesses_pct));
    if (eff.extortion_rate !== undefined) p.extortionRate = eff.extortion_rate;
    if (eff.reclaim_halcones) p.halconesBoughtBy = null;
  }
  if (eff.seize_stash && plazas[0]) {
    const taken = seizeStash(state, content, plazas[0].id, content.tuning.state.raids.stashSeizedShare);
    if (inst.decider === state.playerId && taken > 0) pushFeed(state, 'important', `The army carried off $${Math.round(taken).toLocaleString()} from the stash house.`, plazas[0].id, null);
  }
  if (eff.labs_move_to !== undefined && plazas[0] && plazas[0].labs > 0) moveLab(ctx, inst.decider, plazas[0]);
  if (eff.fear !== undefined) decider.fear = clamp(decider.fear + eff.fear);
  if (eff.respect !== undefined) decider.respect = clamp(decider.respect + eff.respect);
  if (eff.credibility !== undefined) decider.credibility = clamp(decider.credibility + eff.credibility);
  if (eff.profile !== undefined) decider.profile = clamp(decider.profile + eff.profile);
  if (eff.health !== undefined) decider.health = clamp(decider.health + eff.health);
  if (eff.state_intel !== undefined) decider.stateIntel = clamp(decider.stateIntel + eff.state_intel);
  if (eff.men !== undefined) addMen(ctx, decider.id, eff.men);
  if (eff.crew_morale !== undefined) for (const c of crewsOf(state, decider.id)) c.morale = clamp(c.morale + eff.crew_morale);
  const faction = decider.faction ? state.factions[decider.faction] : undefined;
  if (faction && eff.supply !== undefined) faction.supply = clamp(faction.supply + eff.supply);
  if (faction && eff.exhaustion !== undefined) faction.exhaustion = clamp(faction.exhaustion + eff.exhaustion);

  if (other && eff.opinion_scope !== undefined) opinion(other.id, decider.id, eff.opinion_scope);
  if (other && eff.decider_opinion_of_other !== undefined) opinion(decider.id, other.id, eff.decider_opinion_of_other);
  if (eff.opinion_scope_allies !== undefined) {
    const about = other ?? decider;
    for (const r of about.relations) if (RELATIVES.has(r.type) || r.type === 'compadre') opinion(r.target, decider.id, eff.opinion_scope_allies);
  }
  if (eff.opinion_own_faction !== undefined) {
    const h = ownHead(ctx, decider.id);
    if (h) opinion(h, decider.id, eff.opinion_own_faction);
  }
  if (eff.opinion_rival_faction !== undefined) for (const h of rivalHeads(ctx, decider.id)) opinion(h, decider.id, eff.opinion_rival_faction);
  if (eff.opinion_both_factions !== undefined) {
    for (const f of majorFactions(content)) {
      const h = state.factions[f]?.head;
      if (h) opinion(h, decider.id, eff.opinion_both_factions);
    }
  }

  if (eff.declare_alignment !== undefined) declare(ctx, decider.id, eff.declare_alignment === 'neutral' ? null : eff.declare_alignment);
  if (eff.schedule_event !== undefined) scheduleEvent(ctx, eff.schedule_event, inst.scope, inst.decider, inst.other, state.hour + (eff.in_hours ?? 0));
  if (eff.delay_event !== undefined) {
    const until = state.hour + (eff.delay_days ?? 0) * 24;
    state.eventBlocks.push({ event: eff.delay_event, scope: inst.scope, until });
    for (const s of state.scheduledEvents) if (s.event === eff.delay_event && s.scope === inst.scope) s.at = Math.max(s.at, until);
  }
  if (eff.start_military_clash) militaryClash(ctx, decider.id, regionId, plazas[0]?.id ?? null);
  if (eff.truce_days !== undefined && regionId) for (const h of rivalHeads(ctx, decider.id)) addTruce(state, decider.id, h, regionId, eff.truce_days * 24);
  if (eff.end_truce && regionId) breakTruces(state, decider.id, regionId);
  if (eff.bribe_commander_days !== undefined && region) {
    region.commanderBribedUntil = state.hour + eff.bribe_commander_days * 24;
    region.commanderBribedBy = networkOf(state, decider.id);
    region.commanderBribedAt = state.hour;
  }
  if (eff.police_tips && regionId) state.police.push({ owner: decider.id, region: regionId, until: state.hour + content.tuning.state.police.days * 24 });
  if (eff.lie_low_region && regionId) state.lieLow.push({ owner: decider.id, region: regionId, until: state.hour + content.tuning.state.lieLow.days * 24 });
  if (eff.foreign_alliance && decider.foreignAlly === null) foreignAlliance(ctx, decider.id);
  if (eff.add_vendetta && other && other.id !== decider.id) {
    const target = rivalHeads(ctx, other.id)[0];
    if (target && !other.relations.some((r) => r.type === 'vendetta' && r.target === target)) other.relations.push({ type: 'vendetta', target });
  }
  if (eff.set_goal !== undefined) (other ?? decider).goal = eff.set_goal;
  if (eff.compadrazgo && other && other.id !== decider.id) makeCompadres(ctx, decider.id, other.id);
  if (eff.promote_scope && other) other.rank = NEXT_RANK[other.rank];
  if (eff.release_character && other && other.status === 'jailed') {
    other.status = 'free';
    other.statusSince = state.hour;
  }
  if (eff.gain_scope_plazas && other && other.id !== decider.id && decider.faction && other.status === 'free') declare(ctx, other.id, decider.faction);
  if (eff.plant_rumor) {
    const bought = inst.def.scope === 'plaza' ? state.nodes[inst.scope]?.halconesBoughtBy : null;
    const target = bought ?? majorFactions(content).find((f) => f !== networkOf(state, decider.id)) ?? null;
    if (target) plantRumor(ctx, decider.id, target, 'fake_convoy', null, true);
  }
  if (eff.reveal_schemer) for (const s of state.schemes) if (s.target === decider.id) s.discovered = true;
  if (eff.resolve_capture !== undefined) resolveCapture(ctx, inst.scope, eff.resolve_capture);
  if (eff.jail_bribe) jailBribe(ctx, inst.scope, decider.id);
  if (eff.jail_breakout) jailBreakout(ctx, inst.scope, decider.id);
  // Killing comes last: the other character's relatives already reacted above.
  if (eff.kill_scope_character && other && other.id !== decider.id) killCharacter(ctx, other.id);
}

function addMen(ctx: SimContext, id: Id, men: number): void {
  const { state, content } = ctx;
  const crew = crewsOf(state, id)
    .filter((c) => c.battle === null)
    .sort((a, b) => a.men - b.men || (a.id < b.id ? -1 : 1))[0];
  if (!crew || men <= 0) return;
  crew.men = Math.min(content.tuning.crews.maxMen, crew.men + men);
  crew.establishment = Math.max(crew.establishment, crew.men);
}

/** Moves one lab to the nearest sierra plaza the owner holds (by roads); lost if there is none. */
function moveLab(ctx: SimContext, owner: Id, from: PlazaState): void {
  const { state, content } = ctx;
  const w = world(content);
  from.labs -= 1;
  const seen = new Set([from.id]);
  let frontier = [from.id];
  while (frontier.length) {
    const next: Id[] = [];
    for (const n of frontier.sort()) {
      for (const nb of w.neighbors(n)) {
        if (seen.has(nb.other)) continue;
        seen.add(nb.other);
        const type = w.node(nb.other).type;
        if (state.nodes[nb.other]?.owner === owner && (type === 'sierra_hub' || type === 'rancheria')) {
          state.nodes[nb.other]!.labs += 1;
          return;
        }
        next.push(nb.other);
      }
    }
    frontier = next;
  }
}

function makeCompadres(ctx: SimContext, a: Id, b: Id): void {
  const { state } = ctx;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const ch = state.characters[x]!;
    if (!ch.relations.some((r) => r.type === 'compadre' && r.target === y)) ch.relations.push({ type: 'compadre', target: y });
  }
}

/** An outside cartel comes in: a crew of their people, and a cut of your routes from now on. */
function foreignAlliance(ctx: SimContext, id: Id): void {
  const { state, content } = ctx;
  const f = content.tuning.diplomacy.foreignCrew;
  const home = homePlaza(state, id);
  state.characters[id]!.foreignAlly = { since: state.hour };
  if (!home) return;
  const crewId = newId(state, 'crew');
  state.crews[crewId] = {
    id: crewId,
    owner: id,
    leader: id,
    men: f.men,
    skill: f.skill,
    gear: f.gear,
    morale: content.tuning.crews.startingMorale,
    alertness: content.tuning.crews.startingAlertness,
    ammo: 100,
    fatigue: 0,
    vehicles: { pickup: f.pickups, suv: 0, motorcycle: 0, armored: 0 },
    armorDamage: 0,
    location: { kind: 'node', node: home.id },
    order: { type: 'garrison' },
    transit: newTransit(),
    battle: null,
    colonia: null,
    battles: 0,
    establishment: f.men,
    training: null,
    // Their people, lent: they stay the cartel's (GDD "Loaned, not owned").
    hired: { kind: 'contingent', from: content.factions.find((x) => x.kind === 'outside')?.id ?? null, loyalty: content.tuning.outside.loyalty.start, payMultiplier: 1, weekly: null, recallAt: null, defectOffer: null },
  };
  pushFeed(state, 'important', `${charName(ctx, id)} has new partners from outside Sinaloa.`, home.id, null);
}

/** Text with variables filled in. */
export function eventText(ctx: SimContext, inst: Instance, text: string): string {
  const { state, content } = ctx;
  const w = world(content);
  const subject = subjectOf(inst);
  const home = state.characters[subject]?.homePlaza;
  const regionId = scopeRegion(ctx, inst);
  const vars: Record<string, string> = {
    'character.name': charName(ctx, subject),
    'character.home': home ? w.node(home).name : 'their home',
    'plaza.name': inst.def.scope === 'plaza' ? w.node(inst.scope).name : '',
    'region.name': regionId ? (content.regions.find((r) => r.id === regionId)?.name ?? regionId) : '',
    'other.name': inst.other ? charName(ctx, inst.other) : '',
  };
  return text.replace(/\{([a-z_.]+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Plain-language preview of an option's effects (the event popup's hover text). */
export function describeEffects(content: Content, eff: Effects): string[] {
  const out: string[] = [];
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const money = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toLocaleString()}`;
  if (eff.money !== undefined) out.push(`${money(eff.money)} cash`);
  const deltas: [keyof Effects, string][] = [
    ['calentura', 'calentura here'],
    ['calentura_statewide', 'calentura statewide'],
    ['support', 'local support'],
    ['fear', 'fear'],
    ['respect', 'respect'],
    ['credibility', 'credibility'],
    ['profile', 'profile'],
    ['health', 'health'],
    ['state_intel', 'State intel on you'],
    ['halcones', 'halcón coverage'],
    ['labs', 'labs'],
    ['men', 'men'],
    ['crew_morale', 'crew morale'],
    ['supply', 'faction Supply'],
    ['exhaustion', 'faction Exhaustion'],
    ['opinion_scope', 'their opinion of you'],
    ['decider_opinion_of_other', 'your opinion of them'],
    ['opinion_scope_allies', 'opinion of their family'],
    ['opinion_own_faction', 'your head’s opinion'],
    ['opinion_rival_faction', 'rival heads’ opinion'],
    ['opinion_both_factions', 'both heads’ opinion'],
  ];
  for (const [k, label] of deltas) {
    const v = eff[k] as number | undefined;
    if (v !== undefined) out.push(`${sign(v)} ${label}`);
  }
  if (eff.businesses_pct !== undefined) out.push(`${sign(Math.round(eff.businesses_pct * 100))}% businesses`);
  if (eff.extortion_rate) out.push(`extortion set to ${eff.extortion_rate}`);
  if (eff.labs_move_to) out.push('lab moves to your nearest sierra plaza');
  if (eff.declare_alignment) out.push(eff.declare_alignment === 'neutral' ? 'stay neutral' : `declare for the ${content.factions.find((f) => f.id === eff.declare_alignment)?.name ?? eff.declare_alignment}`);
  if (eff.schedule_event) out.push('something follows from this…');
  if (eff.delay_event) out.push(`holds it off ${eff.delay_days ?? 0} days`);
  if (eff.start_military_clash) out.push('a fight with the army');
  if (eff.truce_days) out.push(`local truce for ${eff.truce_days} days`);
  if (eff.end_truce) out.push('breaks the truce');
  if (eff.bribe_commander_days) out.push(`army commander bribed for ${eff.bribe_commander_days} days`);
  if (eff.police_tips) out.push('police on your payroll');
  if (eff.foreign_alliance) out.push('outside partners: a crew, and a cut of your routes');
  if (eff.add_vendetta) out.push('a vendetta');
  if (eff.set_goal) out.push(`their goal becomes ${eff.set_goal.replace('_', ' ')}`);
  if (eff.compadrazgo) out.push('you become compadres');
  if (eff.promote_scope) out.push('promotion');
  if (eff.kill_scope_character) out.push('he dies');
  if (eff.release_character) out.push('he is released');
  if (eff.plant_rumor) out.push('feeds false intel to the other side');
  if (eff.lie_low_region) out.push('lie low in the region');
  if (eff.gain_scope_plazas) out.push('he switches to your side with his plazas');
  if (eff.seize_stash) out.push(`the army takes ${Math.round(content.tuning.state.raids.stashSeizedShare * 100)}% of the stash`);
  if (eff.reclaim_halcones) out.push('your halcones report to you again');
  if (eff.resolve_capture === 'fight') out.push(`fight the army; ${Math.round(content.tuning.state.captureOps.fightEscapeChance * 100)}% to escape`);
  if (eff.resolve_capture === 'flee') out.push(`escape, leaving ${Math.round(content.tuning.state.captureOps.fleeCashLossShare * 100)}% of your cash`);
  if (eff.resolve_capture === 'surrender') out.push('prison, then extradition unless you get out');
  if (eff.jail_bribe) out.push(`−$${content.tuning.state.captureOps.jailBribeCost.toLocaleString()}; ${Math.round(content.tuning.state.captureOps.jailBribeChance * 100)}% to walk free`);
  if (eff.jail_breakout) out.push(`a fight with the army; ${Math.round(content.tuning.state.captureOps.breakoutChance * 100)}% to get out`);
  return out.length ? out : ['no immediate effect'];
}
