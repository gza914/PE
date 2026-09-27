/**
 * Character fates: death, capture, succession, and (until prisoner events land
 * in the events phase) automatic ransom of captives. Opinion decay, health,
 * and ageing come with the characters phase. GDD: "Characters".
 */
import { dayOf } from '../clock';
import { pushFeed, type SimContext } from '../context';
import { charName } from '../orders';
import type { Id } from '../state';

export function runCharactersDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const hold = content.tuning.characters.prisonerHoldDays * 24;
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (ch.status !== 'captured' || state.hour - ch.statusSince < hold) continue;
    const captor = ch.captor ? state.characters[ch.captor] : undefined;
    const ransom = Math.min(ch.cash, content.tuning.characters.ransomAmount);
    ch.cash -= ransom;
    if (captor) captor.cash += ransom;
    ch.status = 'free';
    ch.statusSince = state.hour;
    ch.captor = null;
    const text = `${charName(ctx, id)} was released for a ransom of $${Math.round(ransom).toLocaleString()}.`;
    pushFeed(state, 'important', text, ch.homePlaza, null);
  }
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
    pushFeed(state, 'critical', `You are a prisoner. Your people will pay the ransom within ${ctx.content.tuning.characters.prisonerHoldDays} days.`, null, null);
  }
}

/** Kills a character and hands their plazas, crews, and cash to a successor. */
export function killCharacter(ctx: SimContext, id: Id): void {
  const { state } = ctx;
  const ch = state.characters[id];
  if (!ch || ch.status === 'dead') return;
  ch.status = 'dead';
  ch.statusSince = state.hour;
  ch.captor = null;
  pushFeed(state, 'critical', `${charName(ctx, id)} is dead.`, ch.homePlaza, null);

  const heir = successorOf(ctx, id);
  if (id === state.playerId) {
    if (!heir) {
      state.ended = { reason: 'player_eliminated', hour: state.hour, winner: null };
      pushFeed(state, 'critical', `With no heir to take over, your organization falls apart on day ${dayOf(state.hour)}.`, null, null);
      return;
    }
  }
  if (heir) inherit(ctx, id, heir);
  for (const f of Object.values(state.factions)) if (f.head === id) f.head = heir;
  if (id === state.playerId && heir) {
    state.playerId = heir;
    pushFeed(state, 'critical', `You now play as ${charName(ctx, heir)}, who inherits everything.`, null, null);
  }
}

/** Designated heir if free, else (for non-player characters) their faction head. */
function successorOf(ctx: SimContext, id: Id): Id | null {
  const { state } = ctx;
  const ch = state.characters[id]!;
  if (ch.heir && state.characters[ch.heir]?.status === 'free') return ch.heir;
  if (id === state.playerId) return null;
  const head = ch.faction ? state.factions[ch.faction]?.head : null;
  return head && head !== id && state.characters[head]?.status === 'free' ? head : null;
}

function inherit(ctx: SimContext, from: Id, to: Id): void {
  const { state } = ctx;
  for (const n of Object.values(state.nodes)) if (n.owner === from) n.owner = to;
  for (const c of Object.values(state.crews)) {
    if (c.owner === from) c.owner = to;
    if (c.leader === from) c.leader = to;
  }
  const heir = state.characters[to]!;
  heir.cash += state.characters[from]!.cash;
  state.characters[from]!.cash = 0;
}
