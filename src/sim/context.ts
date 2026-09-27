/** Shared per-tick context handed to every system. */
import type { Content } from '../data/content';
import { networkOf } from './network';
import type { CrewLocation, EngagementType, FeedTier, GameState, Id, NetworkId } from './state';

/** A fight found by movement, started by the combat system in the same tick. */
export interface Engagement {
  type: EngagementType;
  attackers: Id[];
  defenders: Id[];
  where: CrewLocation;
  capture: boolean;
}

export interface SimContext {
  state: GameState;
  content: Content;
  /** Scratch data passed between systems within one tick; never saved. */
  engagements: Engagement[];
  /** Crews that moved this tick (set by movement). */
  moved: Set<Id>;
}

export function newContext(state: GameState, content: Content): SimContext {
  return { state, content, engagements: [], moved: new Set() };
}

export const FEED_LIMIT = 200;

export function newId(state: GameState, prefix: string): Id {
  return `${prefix}_${state.nextId++}`;
}

export function pushFeed(
  state: GameState,
  tier: FeedTier,
  text: string,
  node: Id | null = null,
  audience: NetworkId | null = null,
  battle: Id | null = null,
): void {
  // The feed is the player's; other networks act on reports instead.
  if (audience !== null && audience !== networkOf(state, state.playerId)) return;
  state.feed.push({ id: newId(state, 'feed'), hour: state.hour, tier, audience, battle, text, node });
  if (state.feed.length > FEED_LIMIT) state.feed.splice(0, state.feed.length - FEED_LIMIT);
}
