/**
 * What a network knows. The UI and the AI both read the world through these
 * helpers, so neither sees crews its network has not seen.
 */
import type { Content } from '../data/content';
import { combine, total, type Range } from './estimate';
import { crewNetwork, networkOf } from './network';
import type { Battle, CrewState, GameState, Id, NetworkId, Report } from './state';

export interface Sighting extends Report {
  ageHours: number;
  /** How many reports went into the range (lastSeen only). */
  sources?: number;
}

/** Reports per crew a network holds, no older than `windowHours`. */
function byCrew(state: GameState, network: NetworkId, windowHours: number): Map<Id, Report[]> {
  const out = new Map<Id, Report[]>();
  for (const r of state.reports) {
    if (r.network !== network || state.hour - r.hour > windowHours) continue;
    const list = out.get(r.crew);
    if (list) list.push(r);
    else out.set(r.crew, [r]);
  }
  return out;
}

/**
 * What a network believes about each rival crew it has seen within
 * `windowHours`: the newest report's place, with men as the combined range of
 * every report on it (GDD "Intelligence as estimates").
 */
export function beliefs(state: GameState, content: Content, network: NetworkId, windowHours: number): Sighting[] {
  const out: Sighting[] = [];
  for (const [, list] of byCrew(state, network, windowHours)) {
    const newest = list.reduce((a, b) => (b.hour > a.hour || (b.hour === a.hour && (b.confidence === 'confirmed' || b.id > a.id)) ? b : a));
    const r = combine(content.tuning, list, state.hour);
    out.push({ ...newest, men: r.men, low: r.low, high: r.high, ageHours: state.hour - newest.hour, sources: list.length });
  }
  return out.sort((a, b) => a.ageHours - b.ageHours || (a.crew < b.crew ? -1 : 1));
}

/** A network's combined estimate of one crew's men, or null if unseen within the window. */
export function crewEstimate(state: GameState, content: Content, network: NetworkId, crew: Id, windowHours: number): Range | null {
  const list = state.reports.filter((r) => r.network === network && r.crew === crew && state.hour - r.hour <= windowHours);
  return list.length ? combine(content.tuning, list, state.hour) : null;
}

export interface PlazaIntel extends Range {
  /** Sightings of rival crews in the town. */
  crews: Sighting[];
  /** Someone of ours (a crew or an informant) is inside, so the whole garrison is in view. */
  complete: boolean;
  /** Age of the newest report, or null with none. */
  age: number | null;
  /** Reports used, by source. */
  sources: Partial<Record<Report['source'], number>>;
}

/** What a network believes is in a town, from reports only. */
export function plazaIntel(state: GameState, content: Content, network: NetworkId, node: Id, windowHours: number): PlazaIntel {
  const crews = beliefs(state, content, network, windowHours).filter((s) => s.where.kind === 'node' && s.where.node === node && crewNetworkOfOwner(state, s.owner) !== network);
  const sources: PlazaIntel['sources'] = {};
  for (const r of state.reports) {
    if (r.network !== network || state.hour - r.hour > windowHours || r.where.kind !== 'node' || r.where.node !== node) continue;
    sources[r.source] = (sources[r.source] ?? 0) + 1;
  }
  const sum = total(crews);
  return {
    ...sum,
    crews,
    complete: crews.some((s) => s.source === 'presence' || s.source === 'informant'),
    age: crews.length ? Math.min(...crews.map((s) => s.ageHours)) : null,
    sources,
  };
}

function crewNetworkOfOwner(state: GameState, owner: Id): NetworkId {
  return state.characters[owner] ? networkOf(state, owner) : owner;
}

/** Crews belonging to the network: always known exactly. */
export function ownCrews(state: GameState, network: NetworkId): CrewState[] {
  return Object.values(state.crews).filter((c) => crewNetwork(state, c) === network);
}

/** Every rival crew seen within the fade window, with its combined range. */
export function lastSeen(state: GameState, content: Content, network: NetworkId): Sighting[] {
  return beliefs(state, content, network, content.tuning.detection.lastSeenFadeHours);
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
