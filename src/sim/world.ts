/** Read-only lookups over static content, built once per Content object. */
import type { Content } from '../data/content';
import type { MapNode, Road } from '../data/schemas';
import type { Id } from './state';

export interface Neighbor {
  road: Road;
  other: Id;
}

export interface World {
  node: (id: Id) => MapNode;
  road: (id: Id) => Road;
  neighbors: (node: Id) => readonly Neighbor[];
  /** Roads touching a node, plus roads that pass near it. */
  roadsWatchedBy: (node: Id) => readonly Road[];
}

const cache = new WeakMap<Content, World>();

export function world(content: Content): World {
  let w = cache.get(content);
  if (w) return w;
  const nodes = new Map(content.nodes.map((n) => [n.id, n]));
  const roads = new Map(content.roads.map((r) => [r.id, r]));
  const adj = new Map<Id, Neighbor[]>();
  const watched = new Map<Id, Road[]>();
  const add = <T>(m: Map<Id, T[]>, k: Id, v: T) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const r of content.roads) {
    add(adj, r.from, { road: r, other: r.to });
    add(adj, r.to, { road: r, other: r.from });
    for (const n of [r.from, r.to, ...r.passesNear]) add(watched, n, r);
  }
  w = {
    node: (id) => {
      const n = nodes.get(id);
      if (!n) throw new Error(`unknown node "${id}"`);
      return n;
    },
    road: (id) => {
      const r = roads.get(id);
      if (!r) throw new Error(`unknown road "${id}"`);
      return r;
    },
    neighbors: (id) => adj.get(id) ?? [],
    roadsWatchedBy: (id) => watched.get(id) ?? [],
  };
  cache.set(content, w);
  return w;
}

/** The node at the other end of a road. */
export function otherEnd(road: Road, node: Id): Id {
  return road.from === node ? road.to : road.from;
}
