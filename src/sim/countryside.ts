/**
 * The countryside around each plaza (GDD "The countryside around each plaza"),
 * step one: one zone per plaza with an influence meter per network, camps in
 * the hills, sweeps to clear them, and partial weight in the map share.
 *
 * Who holds the town and who holds the hills are separate facts: crews
 * camped there and the holder's local support raise a side's influence, which
 * otherwise decays. Culiacán (fought by colonia) and border exits have none.
 */
import type { Content } from '../data/content';
import { pushFeed, type SimContext } from './context';
import { groupOf, sortedCrewIds } from './crews';
import { crewNetwork, networkOf } from './network';
import type { CrewState, GameState, Id, NetworkId } from './state';
import { startBattle } from './systems/combat';
import { world } from './world';

/** Why a crew cannot camp around `node`, or null. */
export function campBlocked(content: Content, node: Id): string | null {
  const def = content.nodes.find((n) => n.id === node);
  if (!def) return 'unknown place';
  if (def.type === 'border_exit') return 'there are no hills to hold at a border crossing';
  if (node === content.culiacan.parentNode) return 'Culiacán is fought colonia by colonia';
  return null;
}

export function hasCountryside(content: Content, node: Id): boolean {
  return campBlocked(content, node) === null;
}

/** Zone size: a city's hills take more men to sway than a rancheria's. */
export function zoneSize(content: Content, node: Id): number {
  return content.tuning.countryside.sizeByType[world(content).node(node).type] ?? 1;
}

/** Crews camped around a node (group leaders), in a fixed order. */
export function campersAt(state: GameState, node: Id): CrewState[] {
  return sortedCrewIds(state)
    .map((id) => state.crews[id]!)
    .filter((c) => c.location.kind === 'node' && c.location.node === node && c.order.type === 'camp');
}

/** The network with the most influence around a node, and how much. */
export function dominant(state: GameState, node: Id): { network: NetworkId | null; influence: number } {
  const z = state.countryside[node] ?? {};
  let best: NetworkId | null = null;
  let v = 0;
  for (const net of Object.keys(z).sort()) if (z[net]! > v) (best = net), (v = z[net]!);
  return { network: best, influence: v };
}

/** Daily: camps and local support raise influence; everything else decays. */
export function runCountrysideDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.countryside;
  for (const n of content.nodes) {
    if (!hasCountryside(content, n.id)) continue;
    const z = (state.countryside[n.id] ??= {});
    const size = zoneSize(content, n.id);
    const gain = new Map<NetworkId, number>();
    const add = (net: NetworkId, v: number) => gain.set(net, (gain.get(net) ?? 0) + v);
    for (const c of campersAt(state, n.id)) for (const g of groupOf(state, c)) add(crewNetwork(state, g), (g.men * t.campGainPerManPerDay) / size);
    const plaza = state.nodes[n.id]!;
    if (plaza.owner) {
      const holder = networkOf(state, plaza.owner);
      add(holder, (t.holderGainPerDay * plaza.support) / 100);
      const garrison = Object.values(state.crews).filter((c) => c.location.kind === 'node' && c.location.node === n.id && c.order.type === 'garrison' && crewNetwork(state, c) === holder);
      add(holder, (garrison.reduce((m, c) => m + c.men, 0) * t.garrisonGainPerManPerDay) / size);
    }
    for (const net of new Set([...Object.keys(z), ...gain.keys()])) {
      const v = (z[net] ?? 0) + (gain.get(net) ?? -t.decayPerDay);
      if (v <= 0) delete z[net];
      else z[net] = Math.min(100, v);
    }
  }
}

/** Countryside value by network (GDD "Winning": partial weight), plus the total in play. */
export function countrysideShares(state: GameState, content: Content, valueOf: (node: Id) => number): { byNetwork: Map<NetworkId, number>; total: number } {
  const w = content.tuning.countryside.shareWeight;
  const byNetwork = new Map<NetworkId, number>();
  let total = 0;
  for (const n of content.nodes) {
    if (!hasCountryside(content, n.id)) continue;
    const v = valueOf(n.id) * w;
    if (v <= 0) continue;
    total += v;
    const z = state.countryside[n.id] ?? {};
    const sum = Object.values(z).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (const net of Object.keys(z)) byNetwork.set(net, (byNetwork.get(net) ?? 0) + (v * z[net]!) / sum);
    } else {
      const owner = state.nodes[n.id]!.owner;
      if (owner) byNetwork.set(networkOf(state, owner), (byNetwork.get(networkOf(state, owner)) ?? 0) + v);
    }
  }
  return { byNetwork, total };
}

/** Sweep the hills around the crew's plaza: a rural skirmish in which the campers have the terrain. */
export function sweep(ctx: SimContext, issuer: Id, crewId: Id): string | null {
  const { state, content } = ctx;
  const crew = state.crews[crewId];
  if (!crew || crew.owner !== issuer) return 'not your crew';
  if (crew.battle !== null) return 'that crew is in a battle';
  if (crew.order.type === 'escort') return 'order the column through its lead crew';
  if (crew.location.kind !== 'node') return 'a sweep starts from a plaza';
  const node = crew.location.node;
  const why = campBlocked(content, node);
  if (why) return why;
  if (crew.order.type === 'camp') return 'your men are already in the hills';
  const net = crewNetwork(state, crew);
  const enemies = campersAt(state, node).filter((c) => crewNetwork(state, c) !== net && c.battle === null);
  const name = world(content).node(node).name;
  if (!enemies.length) {
    crew.order = { type: 'garrison' };
    if (issuer === state.playerId) pushFeed(state, 'routine', `Your men combed the hills around ${name} and found no one.`, node, net);
    return null;
  }
  const attackers = groupOf(state, crew);
  const defenders = enemies.flatMap((c) => groupOf(state, c));
  startBattle(ctx, { type: 'sweep', attackers: attackers.map((c) => c.id), defenders: defenders.map((c) => c.id), where: { kind: 'node', node }, capture: false });
  return null;
}

/** The rivals' share of a plaza's hills, from the point of view of `network` (0 with no zone or no one there). */
export function rivalShare(state: GameState, node: Id, network: NetworkId): number {
  const z = state.countryside[node];
  if (!z) return 0;
  const sum = Object.values(z).reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  return (sum - (z[network] ?? 0)) / sum;
}

/** A network's share of a plaza's hills (1 with no zone or no one there). */
export function holdShare(state: GameState, node: Id, network: NetworkId): number {
  const z = state.countryside[node];
  if (!z) return 1;
  const sum = Object.values(z).reduce((a, b) => a + b, 0);
  return sum > 0 ? (z[network] ?? 0) / sum : 1;
}

/** Who holds the countryside a road runs through: the average of its two ends' hills. */
export function roadCountryside(state: GameState, content: Content, roadId: Id): { network: NetworkId | null; influence: number } {
  const road = world(content).road(roadId);
  const sum = new Map<NetworkId, number>();
  for (const n of [road.from, road.to]) for (const [net, v] of Object.entries(state.countryside[n] ?? {})) sum.set(net, (sum.get(net) ?? 0) + v / 2);
  let best: NetworkId | null = null;
  let v = 0;
  for (const net of [...sum.keys()].sort()) if (sum.get(net)! > v) (best = net), (v = sum.get(net)!);
  return { network: best, influence: v };
}

/** Rural lookouts: the side holding a plaza's hills watches the roads into it. */
export function ruralWatcher(state: GameState, content: Content, node: Id): { network: NetworkId; coverage: number } | null {
  const t = content.tuning.countryside;
  const d = dominant(state, node);
  if (!d.network || d.influence < t.lookoutMinInfluence) return null;
  return { network: d.network, coverage: Math.min(100, d.influence * t.lookoutCoveragePerInfluence) };
}

/** Who collects a network's share of a zone's rural economy: the town's holder if his side, else its biggest camp. */
function ruralRecipient(state: GameState, node: Id, network: NetworkId): Id | null {
  const owner = state.nodes[node]?.owner ?? null;
  if (owner && networkOf(state, owner) === network) return owner;
  const camp = campersAt(state, node)
    .filter((c) => crewNetwork(state, c) === network)
    .sort((a, b) => b.men - a.men || (a.id < b.id ? -1 : 1))[0];
  return camp?.owner ?? null;
}

export interface RuralLine {
  recipient: Id;
  node: Id;
  amount: number;
}

/** The rural economy each zone pays today, split by influence. */
export function ruralIncome(state: GameState, content: Content): RuralLine[] {
  const t = content.tuning.countryside;
  const out: RuralLine[] = [];
  for (const n of content.nodes) {
    const z = state.countryside[n.id];
    if (!z) continue;
    const base = t.ruralIncomePerDayPerSize * zoneSize(content, n.id);
    for (const net of Object.keys(z).sort()) {
      const who = ruralRecipient(state, n.id, net);
      if (who) out.push({ recipient: who, node: n.id, amount: (base * z[net]!) / 100 });
    }
  }
  return out;
}

/** Labs out of town produce in proportion to the holder's hold on the hills. */
export function labFactor(state: GameState, content: Content, node: Id): number {
  const t = content.tuning.countryside;
  const owner = state.nodes[node]?.owner;
  if (!owner || !t.labsOutsideTypes.includes(world(content).node(node).type)) return 1;
  return Math.max(t.labFloor, holdShare(state, node, networkOf(state, owner)));
}
