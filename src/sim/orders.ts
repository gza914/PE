/** Order and notification helpers shared by movement, detection, and combat. */
import type { SimContext } from './context';
import { pushFeed } from './context';
import { groupOf, nearerEnd } from './crews';
import { crewNetwork, networkOf, ownedBy } from './network';
import { nearestNode, planRoute } from './routing';
import type { CrewState, FeedTier, Id } from './state';

export function leaderName(ctx: SimContext, crew: CrewState): string {
  const c = ctx.state.characters[crew.leader];
  return c ? (c.alias ?? c.name) : crew.leader;
}

export function charName(ctx: SimContext, id: Id): string {
  const c = ctx.state.characters[id];
  return c ? (c.alias ?? c.name) : id;
}

/** Feed entry about one of the player's own crews. */
export function notifyOwner(ctx: SimContext, crew: CrewState, tier: FeedTier, text: string, node: Id | null, battle: Id | null = null): void {
  if (crew.owner !== ctx.state.playerId) return;
  pushFeed(ctx.state, tier, text, node, networkOf(ctx.state, crew.owner), battle);
}

/** Order a crew on a road to the nearer end, off the road. */
export function relocateOffRoad(ctx: SimContext, crew: CrewState): void {
  if (crew.location.kind !== 'road') return;
  const to = nearerEnd(ctx.content, crew.location);
  crew.order = {
    type: 'move',
    destination: to,
    preference: 'fastest',
    waypoints: [],
    path: [{ road: crew.location.road, to }],
    departAt: null,
    arriveAt: null,
  };
}

/**
 * Send a crew back to the nearest plaza its network holds; idle if there is
 * none. A crew beaten where it stands (`leaveHere`) must fall back elsewhere.
 */
export function sendToRetreat(ctx: SimContext, crew: CrewState, leaveHere = false): void {
  const { state, content } = ctx;
  const net = crewNetwork(state, crew);
  const group = groupOf(state, crew);
  const here = crew.location.kind === 'node' ? crew.location.node : null;
  if (here && !leaveHere && ownedBy(state, here, net)) {
    crew.order = { type: 'garrison' };
    return;
  }
  const base = { crews: group, from: crew.location, departHour: state.hour, viewer: net };
  const dest = nearestNode(state, content, base, (n) => n !== here && ownedBy(state, n, net));
  const route = dest ? planRoute(state, content, { ...base, destination: dest, preference: 'fastest' }) : null;
  crew.order = route && dest ? { type: 'retreat', destination: dest, path: route.path } : { type: 'idle' };
}
