/**
 * What a network knows. The UI and the AI both read the world through these
 * helpers, so neither sees crews its network has not seen.
 */
import type { Content } from '../data/content';
import { crewNetwork } from './network';
import type { CrewState, GameState, NetworkId, Report } from './state';

export interface Sighting extends Report {
  ageHours: number;
}

/** Crews belonging to the network: always known exactly. */
export function ownCrews(state: GameState, network: NetworkId): CrewState[] {
  return Object.values(state.crews).filter((c) => crewNetwork(state, c) === network);
}

/** Latest report per rival crew, no older than the fade window. */
export function lastSeen(state: GameState, content: Content, network: NetworkId): Sighting[] {
  const fade = content.tuning.detection.lastSeenFadeHours;
  const latest = new Map<string, Report>();
  for (const r of state.reports) {
    if (r.network !== network || state.hour - r.hour > fade) continue;
    const prev = latest.get(r.crew);
    if (!prev || r.hour > prev.hour || (r.hour === prev.hour && r.confidence === 'confirmed')) latest.set(r.crew, r);
  }
  return [...latest.values()].map((r) => ({ ...r, ageHours: state.hour - r.hour })).sort((a, b) => a.ageHours - b.ageHours);
}

/** Every report the network holds, newest first (the intel ledger). */
export function ledger(state: GameState, network: NetworkId): Sighting[] {
  return state.reports
    .filter((r) => r.network === network)
    .map((r) => ({ ...r, ageHours: state.hour - r.hour }))
    .sort((a, b) => a.ageHours - b.ageHours || (a.id < b.id ? 1 : -1));
}
