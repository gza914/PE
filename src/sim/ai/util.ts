/** Shared helpers for the utility AI (GDD "AI": Score = value × trait weight × goal weight − risk × caution). */
import type { Content } from '../../data/content';
import type { AiAction } from '../../data/schemas';
import type { SimContext } from '../context';
import type { GameState, Id, RoutePreference } from '../state';
import { GONE_STATUSES } from '../state';

/** Stable per-id offset so AI checks are staggered across hours. */
export function stagger(id: Id, interval: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % interval;
}

/** Trait weight × goal weight for an action. */
export function actionWeight(state: GameState, content: Content, character: Id, action: AiAction): number {
  const ch = state.characters[character];
  if (!ch) return 1;
  let w = content.tuning.ai.goalWeights[ch.goal]?.[action] ?? 1;
  for (const t of ch.traits) w *= content.traits.find((tr) => tr.id === t)?.aiWeights[action] ?? 1;
  return w;
}

/** How much a character discounts risk (trait "caution"; 1 = neutral). */
export function cautionOf(state: GameState, content: Content, character: Id): number {
  let m = 1;
  for (const t of state.characters[character]?.traits ?? []) m *= content.traits.find((tr) => tr.id === t)?.modifiers.caution ?? 1;
  return m;
}

export function preferenceFor(ctx: SimContext, leader: Id): RoutePreference {
  const traits = ctx.state.characters[leader]?.traits ?? [];
  if (traits.includes('impulsivo')) return 'fastest';
  if (traits.includes('calculador') || traits.includes('paranoico') || traits.includes('discreto')) return 'safest';
  return 'balanced';
}

/** Does the AI decide for this character right now? (Everyone but the player, unless on autoplay.) */
export function isAi(state: GameState, id: Id): boolean {
  const ch = state.characters[id];
  return !!ch && ch.outsider === null && (id !== state.playerId || state.autoplay) && ch.status === 'free';
}

/** Does the AI run this character's affairs (economy, idle crews), even while they are held? */
export function aiManaged(state: GameState, id: Id): boolean {
  return (id !== state.playerId || state.autoplay) && state.characters[id]?.outsider == null && !GONE_STATUSES.includes(state.characters[id]?.status ?? 'dead');
}

export function majorFactions(content: Content): Id[] {
  return content.factions.filter((f) => f.kind === 'major').map((f) => f.id);
}
