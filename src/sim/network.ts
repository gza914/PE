/**
 * Networks: who shares halcones and reports. A faction is one network; a
 * neutral character is a network of one.
 */
import type { Content } from '../data/content';
import type { CrewState, GameState, Id, NetworkId } from './state';
import { ruralWatcher } from './countryside';
import { world } from './world';

export function networkOf(state: GameState, character: Id): NetworkId {
  return state.characters[character]?.faction ?? character;
}

export function crewNetwork(state: GameState, crew: CrewState): NetworkId {
  return networkOf(state, crew.owner);
}

export interface Watcher {
  network: NetworkId;
  coverage: number;
}

/**
 * Who has halcones on a node, with their true coverage. Culiacán (the
 * sub-map node) is watched by both major factions.
 */
export function watchersOf(state: GameState, content: Content, node: Id): Watcher[] {
  const plaza = state.nodes[node];
  if (!plaza) return [];
  if (node === content.culiacan.parentNode) {
    if (plaza.halconCoverage <= 0) return [];
    return content.factions
      .filter((f) => f.kind === 'major')
      .map((f) => ({ network: f.id, coverage: plaza.halconCoverage }));
  }
  const base: Watcher[] = [];
  if (plaza.owner && plaza.halconCoverage > 0) {
    // Police on the owner's payroll add eyes; bought halcones report to the buyer instead.
    const region = world(content).node(node).region;
    const police = state.police.some((p) => p.owner === plaza.owner && p.region === region && p.until > state.hour);
    const coverage = Math.min(100, plaza.halconCoverage + (police ? content.tuning.state.police.halconBonus : 0));
    base.push({ network: plaza.halconesBoughtBy ?? networkOf(state, plaza.owner), coverage });
  }
  return withRural(state, content, node, base);
}

/**
 * What a network believes about who watches a node. Its own and unowned
 * plazas are known; rival coverage is assumed, so bad intel gives bad
 * estimates.
 */
export function estimatedWatchersOf(state: GameState, content: Content, node: Id, viewer: NetworkId): Watcher[] {
  const assumed = content.tuning.detection.assumedUnknownCoverage;
  return watchersOf(state, content, node).map((w) => (w.network === viewer ? w : { network: w.network, coverage: assumed }));
}

/** Plazas held by a network. */
export function ownedBy(state: GameState, node: Id, network: NetworkId): boolean {
  const owner = state.nodes[node]?.owner;
  return owner != null && networkOf(state, owner) === network;
}

/** People in the hills watch the roads too (GDD countryside step two). */
function withRural(state: GameState, content: Content, node: Id, list: Watcher[]): Watcher[] {
  const r = ruralWatcher(state, content, node);
  if (!r) return list;
  const same = list.find((w) => w.network === r.network);
  if (same) return list.map((w) => (w === same ? { ...w, coverage: Math.max(w.coverage, r.coverage) } : w));
  return [...list, r];
}
