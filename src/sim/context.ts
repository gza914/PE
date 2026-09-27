/** Shared per-tick context handed to every system. */
import type { Content } from '../data/content';
import type { FeedTier, GameState, Id } from './state';

export interface SimContext {
  state: GameState;
  content: Content;
}

export function newId(state: GameState, prefix: string): Id {
  return `${prefix}_${state.nextId++}`;
}

export function pushFeed(state: GameState, tier: FeedTier, text: string, node: Id | null = null): void {
  state.feed.push({ id: newId(state, 'feed'), hour: state.hour, tier, text, node });
}
