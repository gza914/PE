/** Shared helpers for headless sim tests. */
import { expect } from 'vitest';
import { bundledContent } from '../src/data/bundled';
import type { Content } from '../src/data/content';
import type { Command, OrderRequest } from '../src/sim/commands';
import { newGame, newTransit } from '../src/sim/newGame';
import type { CrewState, GameState } from '../src/sim/state';
import { tick } from '../src/sim/tick';

export const content = bundledContent();

/** Content with tuning overrides, e.g. to make rolls certain. */
export function tuned(mut: (t: Content['tuning']) => void): Content {
  const c = structuredClone(content);
  mut(c.tuning);
  return c;
}

export const noBreakdowns = (t: Content['tuning']) => {
  t.roads.brecha.breakdownChancePerSegment = 0;
};

export function start(seed = 1, playerId = 'c_mazatlan'): GameState {
  return newGame(content, { seed, playerId });
}

export function crewsOf(state: GameState, owner: string): CrewState[] {
  return Object.values(state.crews)
    .filter((c) => c.owner === owner)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Adds a crew with exactly these vehicles. */
export function addCrew(state: GameState, id: string, owner: string, node: string, extra: Partial<CrewState> = {}): CrewState {
  const crew: CrewState = {
    id,
    owner,
    leader: owner,
    men: 12,
    skill: 3,
    gear: 3,
    morale: 70,
    alertness: 50,
    ammo: 100,
    fatigue: 0,
    vehicles: { pickup: 3, suv: 0, motorcycle: 0, armored: 0 },
    armorDamage: 0,
    location: { kind: 'node', node },
    order: { type: 'garrison' },
    transit: newTransit(),
    battle: null,
    colonia: null,
    battles: 0,
    establishment: extra.men ?? 12,
    ...extra,
  };
  state.crews[id] = crew;
  return crew;
}

export function order(state: GameState, crew: CrewState, req: OrderRequest, c = content) {
  const cmd: Command = { type: 'order_crew', issuer: crew.owner, crew: crew.id, order: req };
  const r = tick(state, [cmd], c);
  expect(r.rejected).toEqual([]);
  return r.state;
}

export function run(state: GameState, hours: number, c = content): GameState {
  for (let i = 0; i < hours; i++) state = tick(state, [], c).state;
  return state;
}

/** No AI traffic or breakdowns, so each test controls every crew on the map. */
export const calm = tuned((t) => {
  noBreakdowns(t);
  t.ai.trafficChancePerCheck = 0;
  t.ai.returnHomeChancePerCheck = 0;
});

/** Detection always succeeds. */
export const certain = (t: Content['tuning']) => {
  noBreakdowns(t);
  t.ai.trafficChancePerCheck = 0;
  t.ai.returnHomeChancePerCheck = 0;
  t.detection.maxChance = 1;
  t.detection.coefficient = 10;
};

export function empty(playerId = 'c_mazatlan', c: Content = calm, seed = 1): GameState {
  const s = newGame(c, { seed, playerId });
  for (const id of Object.keys(s.crews)) delete s.crews[id];
  return s;
}
