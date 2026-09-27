/** Shared per-tick context handed to every system. */
import type { Content } from '../data/content';
import type { RoadType } from '../data/schemas';
import { networkOf } from './network';
import type { FeedTier, GameState, Id, NetworkId } from './state';

/** A detection roll queued by movement for the detection system. */
export interface PendingRoll {
  /** Crews moving together (a crew and its escorts). */
  crews: Id[];
  node: Id;
  /** Road the group is on, or null if sitting in the node. */
  roadType: RoadType | null;
}

export function newContext(state: GameState, content: Content): SimContext {
  return { state, content, pendingRolls: [], moved: new Set() };
}

export interface SimContext {
  state: GameState;
  content: Content;
  /** Scratch data passed between systems within one tick; never saved. */
  pendingRolls: PendingRoll[];
  /** Crews that moved this tick (set by movement). */
  moved: Set<Id>;
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
): void {
  // The feed is the player's; other networks act on reports instead.
  if (audience !== null && audience !== networkOf(state, state.playerId)) return;
  state.feed.push({ id: newId(state, 'feed'), hour: state.hour, tier, audience, text, node });
  if (state.feed.length > FEED_LIMIT) state.feed.splice(0, state.feed.length - FEED_LIMIT);
}
