/**
 * Logistics traffic: idle AI crews make supply runs between their network's
 * plazas (routing around rival plazas) and come home afterwards. This keeps
 * the roads busy between the utility AI's bigger decisions.
 */
import type { Command } from '../commands';
import type { SimContext } from '../context';
import { crewNetwork, networkOf, ownedBy } from '../network';
import { chance, pick } from '../rng';
import { nearestNode, travelHours } from '../routing';
import type { CrewState, Id } from '../state';
import { preferenceFor } from './util';

export function supplyRun(ctx: SimContext, crew: CrewState): Command | null {
  const { state, content } = ctx;
  const { ai } = content.tuning;
  if (crew.men > ai.trafficMaxMen || !chance(state.rng, ai.trafficChancePerCheck)) return null;
  const net = crewNetwork(state, crew);
  const here = crew.location.kind === 'node' ? crew.location.node : null;
  const preference = preferenceFor(ctx, crew.leader);
  const hours = travelHours(state, content, { crews: [crew], from: crew.location, preference, departHour: state.hour, viewer: net, noPassThrough: rivalPlazas(ctx, net) });
  const targets = content.nodes
    .map((n) => n.id)
    .filter((n) => n !== here && ownedBy(state, n, net) && (hours.get(n) ?? Infinity) <= ai.trafficMaxTripHours);
  if (!targets.length) return null;
  return { type: 'order_crew', issuer: crew.owner, crew: crew.id, order: { type: 'move', destination: pick(state.rng, targets), preference, avoidRivalPlazas: true } };
}

/** Plazas held by any network other than `net`: supply runs go around them. */
export function rivalPlazas(ctx: SimContext, net: string): Id[] {
  return Object.values(ctx.state.nodes)
    .filter((n) => n.owner !== null && networkOf(ctx.state, n.owner) !== net)
    .map((n) => n.id)
    .sort();
}

export function returnHome(ctx: SimContext, crew: CrewState): Command | null {
  const { state, content } = ctx;
  if (!chance(state.rng, content.tuning.ai.returnHomeChancePerCheck)) return null;
  const home = nearestNode(
    state,
    content,
    { crews: [crew], from: crew.location, departHour: state.hour, viewer: networkOf(state, crew.owner) },
    (n) => state.nodes[n]?.owner === crew.owner,
  );
  if (!home) return null;
  return { type: 'order_crew', issuer: crew.owner, crew: crew.id, order: { type: 'move', destination: home, preference: preferenceFor(ctx, crew.leader), avoidRivalPlazas: true } };
}

