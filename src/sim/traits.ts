/** Trait modifier lookups: the product of a named modifier over a character's traits (1 when absent). */
import type { Content } from '../data/content';
import type { GameState, Id } from './state';

export function traitProduct(state: GameState, content: Content, id: Id, key: string): number {
  let m = 1;
  for (const t of state.characters[id]?.traits ?? []) m *= content.traits.find((tr) => tr.id === t)?.modifiers[key] ?? 1;
  return m;
}
