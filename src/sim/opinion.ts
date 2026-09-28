/**
 * Opinion: what one character thinks of another, from -100 to +100. It is the
 * sum of modifiers (most decay linearly to zero) plus permanent bases from
 * relationships and shared faction. GDD: "Opinion".
 */
import type { Content } from '../data/content';
import type { GameState, Id, OpinionModifier } from './state';

export function modifierValue(m: OpinionModifier, hour: number): number {
  if (m.decayDays === null) return m.value;
  const left = 1 - (hour - m.addedAt) / (m.decayDays * 24);
  return left <= 0 ? 0 : m.value * left;
}

export interface OpinionLine {
  key: string;
  value: number;
}

/** Every contribution to `from`'s opinion of `to`, for the CK3-style hover breakdown. */
export function opinionBreakdown(state: GameState, content: Content, from: Id, to: Id): OpinionLine[] {
  const a = state.characters[from];
  const b = state.characters[to];
  if (!a || !b || from === to) return [];
  const lines: OpinionLine[] = [];
  for (const r of a.relations) {
    if (r.target === to) lines.push({ key: `relation_${r.type}`, value: content.tuning.characters.relationOpinion[r.type] });
  }
  if (a.faction !== null && a.faction === b.faction) lines.push({ key: 'same_faction', value: content.tuning.characters.sharedFactionOpinion });
  const byKey = new Map<string, number>();
  for (const m of a.opinions[to] ?? []) byKey.set(m.key, (byKey.get(m.key) ?? 0) + modifierValue(m, state.hour));
  for (const [key, value] of [...byKey].sort(([x], [y]) => (x < y ? -1 : 1))) if (Math.abs(value) >= 0.5) lines.push({ key, value });
  return lines;
}

export function opinionOf(state: GameState, content: Content, from: Id, to: Id): number {
  const sum = opinionBreakdown(state, content, from, to).reduce((n, l) => n + l.value, 0);
  const { opinionMin, opinionMax } = content.tuning.characters;
  return Math.max(opinionMin, Math.min(opinionMax, sum));
}

/** Adds a modifier to `from`'s opinion of `to`. Leal characters' modifiers fade half as fast. */
export function addOpinion(state: GameState, content: Content, from: Id, to: Id, key: string, value: number, decayDays: number | null): void {
  const a = state.characters[from];
  if (!a || from === to) return;
  let decay = decayDays;
  if (decay !== null) {
    for (const t of a.traits) {
      const tr = content.traits.find((x) => x.id === t);
      const mult = value < 0 ? (tr?.modifiers.negativeOpinionDecayMultiplier ?? tr?.modifiers.opinionDecayMultiplier) : tr?.modifiers.opinionDecayMultiplier;
      if (mult !== undefined) decay = mult <= 0 ? null : decay === null ? null : decay / mult;
    }
  }
  (a.opinions[to] ??= []).push({ key, value, addedAt: state.hour, decayDays: decay });
}

/** Drops modifiers that have decayed away. Runs daily. */
export function pruneOpinions(state: GameState): void {
  for (const ch of Object.values(state.characters)) {
    for (const [target, mods] of Object.entries(ch.opinions)) {
      const kept = mods.filter((m) => m.decayDays === null || state.hour - m.addedAt < m.decayDays * 24);
      if (kept.length) ch.opinions[target] = kept;
      else delete ch.opinions[target];
    }
  }
}
