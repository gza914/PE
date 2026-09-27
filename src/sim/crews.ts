/** Crew grouping and location helpers shared by movement, detection, and commands. */
import type { Content } from '../data/content';
import type { CrewLocation, CrewState, GameState, Id } from './state';
import { world } from './world';

/** Crews escorting `crew`. Escorts share its location and move with it. */
export function escortsOf(state: GameState, crew: CrewState): CrewState[] {
  return Object.values(state.crews)
    .filter((c) => c.order.type === 'escort' && c.order.crew === crew.id)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** A crew plus its escorts: they move, and are seen, as one group. */
export function groupOf(state: GameState, crew: CrewState): CrewState[] {
  return [crew, ...escortsOf(state, crew)];
}

export function sortedCrewIds(state: GameState): Id[] {
  return Object.keys(state.crews).sort();
}

type RoadLocation = Extract<CrewLocation, { kind: 'road' }>;

/** Position on a road measured from the road's own `from` node. */
export function kmFromRoadStart(content: Content, loc: RoadLocation): number {
  const road = world(content).road(loc.road);
  return loc.from === road.from ? loc.progressKm : road.lengthKm - loc.progressKm;
}

export function sameLocation(content: Content, a: CrewLocation, b: CrewLocation): boolean {
  if (a.kind === 'node' || b.kind === 'node') return a.kind === 'node' && b.kind === 'node' && a.node === b.node;
  return a.road === b.road && Math.abs(kmFromRoadStart(content, a) - kmFromRoadStart(content, b)) < 1e-6;
}

/** The end of the road a crew is nearer to (ties go to where it is heading). */
export function nearerEnd(content: Content, loc: RoadLocation): Id {
  const road = world(content).road(loc.road);
  return loc.progressKm * 2 > road.lengthKm ? loc.to : loc.progressKm * 2 < road.lengthKm ? loc.from : loc.to;
}
