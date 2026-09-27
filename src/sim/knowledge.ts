/**
 * What a network knows. The UI and the AI both read the world through these
 * helpers, so neither sees crews its network has not seen.
 */
import type { Content } from '../data/content';
import { crewNetwork } from './network';
import type { Battle, CrewState, GameState, Id, NetworkId, Report } from './state';

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

/**
 * Rival crews a network can see in a Culiacán colonia: those in colonias where
 * it has crews of its own (in contact) or that its side holds.
 */
export function visibleInColonia(state: GameState, content: Content, network: NetworkId, colonia: Id): CrewState[] {
  const here = Object.values(state.crews).filter(
    (c) => c.colonia === colonia && c.location.kind === 'node' && c.location.node === content.culiacan.parentNode,
  );
  const control = state.colonias[colonia]?.control ?? 0;
  const flip = content.tuning.map.coloniaFlipThreshold;
  const held = network === content.culiacan.positiveFaction ? control >= flip : control <= -flip && content.factions.some((f) => f.id === network && f.kind === 'major');
  const contact = here.some((c) => crewNetwork(state, c) === network);
  return here.filter((c) => crewNetwork(state, c) !== network && (contact || held));
}

/** Enemy crews in a battle are in plain sight of the side fighting them. */
export function battleEnemies(state: GameState, network: NetworkId, b: Battle): CrewState[] {
  const k = b.attackers.network === network ? 'defenders' : b.defenders.network === network ? 'attackers' : null;
  if (!k) return [];
  return b[k].crews.map((id) => state.crews[id]).filter((c): c is CrewState => !!c);
}
