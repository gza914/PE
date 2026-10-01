/**
 * Character fates: death, capture, succession, and (until prisoner events land
 * in the events phase) automatic ransom of captives. Opinion decay, health,
 * and ageing come with the characters phase. GDD: "Characters".
 */
import { dayOf } from '../clock';
import { pushFeed, type SimContext } from '../context';
import { charName } from '../orders';
import { endGame } from './endings';
import { runCaptivesDaily } from '../capture';
import { networkOf } from '../network';
import type { Id } from '../state';
import { isGone } from '../state';

export function runCharactersDaily(ctx: SimContext): void {
  runCaptivesDaily(ctx);
}

/** Takes a character prisoner. */
export function captureCharacter(ctx: SimContext, id: Id, captor: Id): void {
  const { state } = ctx;
  const ch = state.characters[id];
  if (!ch || ch.status !== 'free') return;
  ch.status = 'captured';
  ch.statusSince = state.hour;
  ch.captor = captor;
  pushFeed(state, 'critical', `${charName(ctx, id)} was captured by ${charName(ctx, captor)}'s people.`, ch.homePlaza, null);
  if (id === state.playerId) {
    pushFeed(state, 'critical', `You are a prisoner. ${charName(ctx, captor)} will decide what to do with you.`, null, null);
  } else if (captor === state.playerId) {
    pushFeed(state, 'critical', `Your people took ${charName(ctx, id)}. Decide what to do with him (Shadows > Captives).`, null, networkOf(state, captor));
  }
}

/** Kills (or extradites) a character and hands their plazas, crews, and cash to a successor. */
export function killCharacter(ctx: SimContext, id: Id, fate: 'dead' | 'extradited' | 'fled' = 'dead'): void {
  const { state } = ctx;
  const ch = state.characters[id];
  if (!ch || isGone(ch.status)) return;
  ch.status = fate;
  ch.statusSince = state.hour;
  ch.captor = null;
  pushFeed(state, 'critical', fate === 'dead' ? `${charName(ctx, id)} is dead.` : fate === 'fled' ? `${charName(ctx, id)} left Sinaloa with what cash he had.` : `${charName(ctx, id)} was extradited and is gone for good.`, ch.homePlaza, null);

  const heir = successorOf(ctx, id);
  // His prisoners pass to his heir, or walk free.
  for (const c of Object.values(state.characters)) {
    if (c.status !== 'captured' || c.captor !== id) continue;
    if (heir) c.captor = heir;
    else (c.status = 'free'), (c.statusSince = state.hour), (c.captor = null);
  }
  if (id === state.playerId && !heir) {
    dissolve(ctx, id);
    endGame(ctx, 'player_eliminated', null, `With no heir to take over, your organization falls apart on day ${dayOf(state.hour)}.`);
    return;
  }
  if (heir) inherit(ctx, id, heir);
  else dissolve(ctx, id);
  for (const f of Object.values(state.factions)) if (f.head === id) f.head = heir;
  if (id === state.playerId && heir) {
    state.playerId = heir;
    pushFeed(state, 'critical', `You now play as ${charName(ctx, heir)}, who inherits everything.`, null, null);
  }
}

/**
 * Who takes over: the designated heir if free; for AI characters, else the
 * faction head (even a captured one), else the highest-ranked free member.
 * With no one at all, the organization dissolves.
 */
function successorOf(ctx: SimContext, id: Id): Id | null {
  const { state } = ctx;
  const ch = state.characters[id]!;
  if (ch.heir && state.characters[ch.heir]?.status === 'free') return ch.heir;
  // A human player only continues through their designated heir; on autoplay, anyone may take over.
  if (id === state.playerId && !state.autoplay) return null;
  const head = ch.faction ? state.factions[ch.faction]?.head : null;
  const hs = head ? state.characters[head]?.status : undefined;
  if (head && head !== id && (hs === 'free' || hs === 'captured' || hs === 'jailed')) return head;
  const RANK = { head: 5, inner_circle: 4, senior_lieutenant: 3, lieutenant: 2, associate: 1, crew_leader: 1 } as const;
  const member = Object.values(state.characters)
    .filter((c) => c.id !== id && c.status === 'free' && c.outsider === null && ch.faction !== null && c.faction === ch.faction)
    .sort((a, b) => RANK[b.rank] - RANK[a.rank] || (a.id < b.id ? -1 : 1))[0];
  return member?.id ?? null;
}

/** No successor: plazas go unowned and crews scatter. */
function dissolve(ctx: SimContext, id: Id): void {
  const { state } = ctx;
  for (const n of Object.values(state.nodes)) if (n.owner === id) n.owner = null;
  for (const c of Object.values(state.crews)) {
    if (c.owner !== id) continue;
    // Battles drop missing crews on their next hour.
    for (const e of Object.values(state.crews)) if (e.order.type === 'escort' && e.order.crew === c.id) e.order = { type: 'idle' };
    delete state.crews[c.id];
  }
}

function inherit(ctx: SimContext, from: Id, to: Id): void {
  const { state } = ctx;
  for (const n of Object.values(state.nodes)) if (n.owner === from) n.owner = to;
  for (const c of Object.values(state.crews)) {
    if (c.owner === from) c.owner = to;
    if (c.leader === from) c.leader = to;
  }
  // Stashes follow the plazas; the purse goes to the heir.
  state.characters[to]!.purse += state.characters[from]!.purse;
  state.characters[from]!.purse = 0;
}
