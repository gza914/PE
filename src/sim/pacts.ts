/**
 * Pacts between characters. Phase 5 uses local truces (from events such as a
 * priest's mediation or a rival's offer): no fighting between the two sides'
 * networks in one region until the truce expires or someone breaks it.
 * GDD: "Pacts between characters".
 */
import { newId } from './context';
import { networkOf } from './network';
import type { GameState, Id, NetworkId } from './state';

function live(state: GameState) {
  return state.pacts.filter((p) => p.type === 'local_truce' && (p.expiresAt === null || p.expiresAt > state.hour));
}

/** Is there a local truce between these two networks in this region right now? */
export function truceBetween(state: GameState, a: NetworkId, b: NetworkId, region: Id): boolean {
  if (a === b) return false;
  return live(state).some((p) => {
    if (p.region !== region) return false;
    const x = networkOf(state, p.parties[0]);
    const y = networkOf(state, p.parties[1]);
    return (x === a && y === b) || (x === b && y === a);
  });
}

export function addTruce(state: GameState, a: Id, b: Id, region: Id, hours: number): void {
  const parties: [Id, Id] = a < b ? [a, b] : [b, a];
  const existing = live(state).find((p) => p.region === region && p.parties[0] === parties[0] && p.parties[1] === parties[1]);
  if (existing) {
    existing.expiresAt = Math.max(existing.expiresAt ?? 0, state.hour + hours);
    return;
  }
  state.pacts.push({ id: newId(state, 'pact'), type: 'local_truce', parties, secret: false, expiresAt: state.hour + hours, region });
}

/** Ends every truce the character's network holds in a region. Returns how many were broken. */
export function breakTruces(state: GameState, who: Id, region: Id): number {
  const net = networkOf(state, who);
  let n = 0;
  for (const p of live(state)) {
    if (p.region !== region) continue;
    if (networkOf(state, p.parties[0]) === net || networkOf(state, p.parties[1]) === net) {
      p.expiresAt = state.hour;
      n++;
    }
  }
  return n;
}

/** Drops expired pacts. */
export function prunePacts(state: GameState): void {
  state.pacts = state.pacts.filter((p) => p.expiresAt === null || p.expiresAt > state.hour);
}
