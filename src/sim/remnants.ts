/**
 * A boss who has lost everything (GDD "A boss who has lost everything"):
 * losing his last plaza no longer means fading away. He goes to ground in the
 * hills around his old plaza, serves another boss, goes neutral to rebuild,
 * defects, or flees Sinaloa. AI bosses choose by traits; the player chooses
 * from a prompt and is never eliminated for losing plazas alone.
 */
import { pushFeed, type SimContext } from './context';
import { orderCrew } from './commands';
import { campBlocked } from './countryside';
import { declare } from './diplomacy';
import { networkOf } from './network';
import { charName } from './orders';
import type { Rank } from '../data/schemas';
import type { GameState, Id } from './state';
import { endGame } from './systems/endings';
import { killCharacter } from './systems/characters';
import { cashOf } from './money';
import { world } from './world';

export type LostChoice = 'ground' | 'serve' | 'neutral' | 'defect' | 'flee';
export const LOST_CHOICES: LostChoice[] = ['ground', 'serve', 'neutral', 'defect', 'flee'];

const RANKS: Rank[] = ['crew_leader', 'associate', 'lieutenant', 'senior_lieutenant', 'inner_circle', 'head'];

/** Daily: notice bosses who just lost their last plaza. */
export function runRemnantsDaily(ctx: SimContext): void {
  const { state } = ctx;
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (ch.outsider !== null) continue;
    const held = Object.keys(state.nodes)
      .sort()
      .filter((n) => state.nodes[n]!.owner === id);
    const before = ch.plazasHeld;
    ch.plazasHeld = held.length;
    if (held.length) {
      ch.lastPlaza = ch.homePlaza && held.includes(ch.homePlaza) ? ch.homePlaza : held[0]!;
      if (id === state.playerId) ch.lostEverythingAt = null;
      continue;
    }
    if (before === 0 || ch.status !== 'free') continue;
    if (ch.faction !== null && state.factions[ch.faction]?.head === id) continue;
    if (id === state.playerId && !state.autoplay) {
      ch.lostEverythingAt = state.hour;
      pushFeed(state, 'critical', 'You have lost your last plaza. You are not finished: choose what to do (Shadows tab).', ch.lastPlaza, networkOf(state, id));
      continue;
    }
    chooseLost(ctx, id, aiLostChoice(state, id), null);
  }
}

export function aiLostChoice(state: GameState, id: Id): LostChoice {
  const ch = state.characters[id]!;
  const has = (t: string) => ch.traits.includes(t);
  if (has('cobarde')) return 'flee';
  if (has('vengativo')) return 'ground';
  if (has('leal') && ch.faction !== null) return 'serve';
  if (has('ambicioso')) return 'neutral';
  const crews = Object.values(state.crews).filter((c) => c.owner === id);
  return crews.length ? 'ground' : ch.faction !== null ? 'serve' : 'flee';
}

/** Why `id` cannot make this choice, or null. */
export function lostBlocked(state: GameState, id: Id, choice: LostChoice, boss: Id | null): string | null {
  const ch = state.characters[id];
  if (!ch || ch.status !== 'free') return 'only a free boss can choose';
  if (Object.values(state.nodes).some((n) => n.owner === id)) return 'you still hold a plaza';
  switch (choice) {
    case 'serve': {
      if (ch.faction === null) return 'a neutral has no side to serve';
      if (boss !== null) {
        const b = state.characters[boss];
        if (!b || b.status !== 'free' || b.faction !== ch.faction || b.outsider !== null || boss === id) return 'pick a free boss on your side';
      }
      return serveTarget(state, id, boss) ? null : 'no boss on your side can take you in';
    }
    case 'neutral':
      return ch.faction === null ? 'you are already on your own' : null;
    case 'defect':
      return ch.faction === null ? 'you have no side to defect from' : null;
    default:
      return null;
  }
}

function serveTarget(state: GameState, id: Id, boss: Id | null): Id | null {
  const ch = state.characters[id]!;
  if (boss) return boss;
  return (
    Object.values(state.characters)
      .filter((c) => c.id !== id && c.status === 'free' && c.outsider === null && c.faction === ch.faction && Object.values(state.nodes).some((n) => n.owner === c.id))
      .map((c) => ({ id: c.id, men: Object.values(state.crews).filter((x) => x.owner === c.id).reduce((n, x) => n + x.men, 0) }))
      .sort((a, b) => b.men - a.men || (a.id < b.id ? -1 : 1))[0]?.id ?? null
  );
}

export function chooseLost(ctx: SimContext, id: Id, choice: LostChoice, boss: Id | null): string | null {
  const { state, content } = ctx;
  const blocked = lostBlocked(state, id, choice, boss);
  if (blocked) return blocked;
  const ch = state.characters[id]!;
  const name = charName(ctx, id);
  const mine = Object.values(state.crews)
    .filter((c) => c.owner === id && c.battle === null && c.order.type !== 'escort')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  ch.lostEverythingAt = null;
  switch (choice) {
    case 'ground': {
      const hills = ch.lastPlaza && campBlocked(content, ch.lastPlaza) === null ? ch.lastPlaza : null;
      for (const c of mine) {
        if (!hills) break;
        if (c.location.kind === 'node' && c.location.node === hills) c.order = { type: 'camp', since: state.hour };
        else orderCrew(ctx, c, { type: 'move', destination: hills, preference: 'safest', onArrive: 'camp' });
      }
      pushFeed(state, 'important', `${name} went to ground${hills ? ` in the hills around ${world(content).node(hills).name}` : ''}, waiting for his chance.`, hills, null);
      return null;
    }
    case 'serve': {
      const to = serveTarget(state, id, boss)!;
      for (const c of Object.values(state.crews)) if (c.owner === id) c.owner = to;
      const i = RANKS.indexOf(ch.rank);
      ch.rank = RANKS[Math.max(0, i - content.tuning.lostEverything.serveRankDrop)]!;
      pushFeed(state, 'important', `${name} now serves ${charName(ctx, to)}, his men with him.`, null, null);
      return null;
    }
    case 'neutral':
      declare(ctx, id, null);
      pushFeed(state, 'important', `${name} left his side to rebuild on his own.`, null, null);
      return null;
    case 'defect': {
      const other = content.factions.find((f) => f.kind === 'major' && f.id !== ch.faction)?.id ?? null;
      declare(ctx, id, other);
      pushFeed(state, 'important', `${name} went over to the other side, with everything he knows.`, null, null);
      return null;
    }
    case 'flee': {
      const cash = cashOf(state, id);
      if (id === state.playerId) {
        endGame(ctx, 'player_fled', null, `You left Sinaloa with $${Math.round(cash).toLocaleString()}. Maybe someday.`);
        return null;
      }
      ch.purse = 0;
      killCharacter(ctx, id, 'fled');
      return null;
    }
  }
}
