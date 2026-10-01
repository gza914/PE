/**
 * The AI's picture of the enemy, built only from its own network's reports
 * (GDD "No cheating on information"). Where it has no fresh intel on a rival
 * plaza it assumes a typical garrison, so scouting pays and bad intel misleads.
 */
import type { Content } from '../../data/content';
import { total } from '../estimate';
import { beliefs } from '../knowledge';
import { crewNetwork, networkOf } from '../network';
import { groupPower } from '../power';
import type { CrewState, GameState, Id, NetworkId } from '../state';
import { world } from '../world';

export interface Believed {
  crew: Id;
  owner: Id;
  /** Most likely men, and the range the reports support. */
  men: number;
  low: number;
  high: number;
  hour: number;
  /** Seen by our own people (a crew or an informant) in the node, so the whole garrison was in view. */
  presence: boolean;
}

export interface Estimate {
  /** Men believed there (most likely), and the range. */
  men: number;
  low: number;
  high: number;
  /** Fighting power, with fortification and terrain for a defender. */
  power: number;
  /** False if this is only the assumed garrison. */
  known: boolean;
  /** Age in hours of the newest report used. */
  age: number;
}

/** Per-tick cache: what each network believes is where. */
export class Intel {
  private atNode = new Map<NetworkId, Map<Id, Believed[]>>();
  private onRoad = new Map<NetworkId, Map<Id, Believed[]>>();

  constructor(
    private state: GameState,
    private content: Content,
  ) {}

  private build(net: NetworkId): void {
    if (this.atNode.has(net)) return;
    const { state, content } = this;
    const stale = content.tuning.ai.strategic.intelStaleHours;
    const nodes = new Map<Id, Believed[]>();
    const roads = new Map<Id, Believed[]>();
    for (const r of beliefs(state, content, net, stale).sort((a, b) => (a.crew < b.crew ? -1 : 1))) {
      const b: Believed = { crew: r.crew, owner: r.owner, men: r.men, low: r.low, high: r.high, hour: r.hour, presence: r.source === 'presence' || r.source === 'informant' };
      if (r.where.kind === 'node') nodes.set(r.where.node, [...(nodes.get(r.where.node) ?? []), b]);
      else roads.set(r.where.road, [...(roads.get(r.where.road) ?? []), b]);
    }
    this.atNode.set(net, nodes);
    this.onRoad.set(net, roads);
  }

  believedAt(net: NetworkId, node: Id): Believed[] {
    this.build(net);
    return this.atNode.get(net)!.get(node) ?? [];
  }

  believedOnRoad(net: NetworkId, road: Id): Believed[] {
    this.build(net);
    return this.onRoad.get(net)!.get(road) ?? [];
  }

  /** Own crews at a node (exact). */
  ownAt(net: NetworkId, node: Id): CrewState[] {
    return Object.values(this.state.crews).filter(
      (c) => c.location.kind === 'node' && c.location.node === node && c.colonia === null && crewNetwork(this.state, c) === net,
    );
  }

  /** How strong `net` believes a plaza's defense is. */
  defense(net: NetworkId, node: Id): Estimate {
    const { state, content } = this;
    const c = content.tuning.combat;
    const plaza = state.nodes[node]!;
    const def = world(content).node(node);
    const multiplier = (1 + c.fortificationBonusPerLevel * plaza.fortification) * (c.terrain[c.nodeTerrain[def.type]] ?? 1);
    if (plaza.owner && networkOf(state, plaza.owner) === net) {
      const own = this.ownAt(net, node);
      const men = own.reduce((n, x) => n + x.men, 0);
      return { men, low: men, high: men, power: groupPower(state, content, own) * multiplier, known: true, age: 0 };
    }
    const seen = this.believedAt(net, node).filter((b) => networkOf(state, b.owner) !== net);
    const prior = plaza.owner ? content.tuning.ai.strategic.priorGarrisonMenByType[def.type] : 0;
    const sum = total(seen);
    const age = seen.length ? state.hour - Math.max(...seen.map((b) => b.hour)) : Infinity;
    // Only someone inside the plaza sees the whole garrison. Otherwise a few
    // sightings are a floor, not the full picture: assume at least the prior.
    const complete = seen.some((b) => b.presence);
    const men = complete ? sum.men : Math.max(sum.men, prior);
    const low = complete ? sum.low : Math.max(sum.low, Math.min(prior, sum.high));
    const high = complete ? sum.high : Math.max(sum.high, prior);
    const planned = men + content.tuning.ai.strategic.rangeCaution * Math.max(0, high - men);
    return { men, low, high, power: planned * c.estimatedPowerPerMan * multiplier, known: complete, age };
  }

  /** Rival strength `net` believes is within `hops` of a node, from recent reports (nodes and roads). */
  nearbyEnemy(net: NetworkId, node: Id, hops: number, recentHours: number): number {
    const { state, content } = this;
    const w = world(content);
    const near = withinHops(content, node, hops);
    let men = 0;
    const counted = new Set<Id>();
    const take = (list: Believed[], node: Id | null) => {
      for (const b of list) {
        if (counted.has(b.crew) || state.hour - b.hour > recentHours || networkOf(state, b.owner) === net) continue;
        // A rival garrison sitting in its own plaza is not coming for us.
        const holder = node ? state.nodes[node]?.owner : null;
        if (holder && networkOf(state, holder) === networkOf(state, b.owner)) continue;
        counted.add(b.crew);
        men += b.men;
      }
    };
    for (const n of near) {
      take(this.believedAt(net, n), n);
      for (const nb of w.neighbors(n)) if (near.has(nb.other)) take(this.believedOnRoad(net, nb.road.id), null);
    }
    return men * content.tuning.combat.estimatedPowerPerMan;
  }
}

const hopCache = new WeakMap<Content, Map<string, Set<Id>>>();

/** Nodes within `hops` road steps of a node (including it). */
export function withinHops(content: Content, node: Id, hops: number): Set<Id> {
  let cache = hopCache.get(content);
  if (!cache) hopCache.set(content, (cache = new Map()));
  const key = `${node}:${hops}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = world(content);
  const seen = new Set<Id>([node]);
  let frontier = [node];
  for (let i = 0; i < hops; i++) {
    const next: Id[] = [];
    for (const n of frontier) for (const nb of w.neighbors(n)) if (!seen.has(nb.other)) (seen.add(nb.other), next.push(nb.other));
    frontier = next;
  }
  cache.set(key, seen);
  return seen;
}
