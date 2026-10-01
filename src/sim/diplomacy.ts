/**
 * Declaring for a side and switching sides. Declaring from neutral is free.
 * Leaving a coalition is politics, not a crime: the old head holds a grudge
 * that fades over a year, and the new faction starts suspicious.
 * GDD: "Factions and diplomacy".
 */
import { pushFeed, type SimContext } from './context';
import { addOpinion } from './opinion';
import { charName } from './orders';
import type { Id } from './state';

/** Pulls a character's crews out of battles and offensives (their side is changing). */
function disengage(ctx: SimContext, id: Id): void {
  const { state } = ctx;
  for (const c of Object.values(state.crews)) {
    if (c.owner !== id) continue;
    if (c.battle !== null) {
      const b = state.battles[c.battle];
      if (b) for (const side of [b.attackers, b.defenders]) side.crews = side.crews.filter((x) => x !== c.id);
      c.battle = null;
    }
    c.order = c.location.kind === 'node' ? { type: 'garrison' } : { type: 'idle' };
  }
  for (const o of state.offensives) o.crews = o.crews.filter((x) => state.crews[x]?.owner !== id);
  for (const r of state.requests) if (r.to === id && (r.status === 'pending' || r.status === 'accepted')) {
    r.status = 'cancelled';
    r.resolvedAt = state.hour;
  }
}

/** Sets a character's side. `faction` null means neutral. */
export function declare(ctx: SimContext, id: Id, faction: Id | null): void {
  const { state, content } = ctx;
  const ch = state.characters[id];
  if (!ch || ch.faction === faction) return;
  const d = content.tuning.diplomacy;
  const old = ch.faction;
  if (old !== null && state.hour > 0) {
    const oldHead = state.factions[old]?.head;
    if (oldHead && oldHead !== id) addOpinion(state, content, oldHead, id, 'traitor', d.traitorOpinion, d.traitorDecayDays);
  }
  if (faction !== null && old !== null && state.hour > 0) {
    const newHead = state.factions[faction]?.head;
    if (newHead && newHead !== id) addOpinion(state, content, newHead, id, 'turncoat', d.sideSwitchNewFactionOpinion, content.tuning.events.opinionDecayDays);
  }
  if (state.hour > 0) disengage(ctx, id);
  ch.faction = faction;
  ch.declaredAt = state.hour;
  const side = faction === null ? 'neutral' : (content.factions.find((f) => f.id === faction)?.name ?? faction);
  if (state.hour > 0) pushFeed(state, 'important', `${charName(ctx, id)} ${faction === null ? 'goes' : 'declares for the'} ${side}.`, ch.homePlaza, null);
}
