/**
 * Operational layer: every AI character with crews, every few hours
 * (staggered) (GDD "AI"). A lieutenant first answers any faction requests,
 * then considers its own initiatives and takes the best one that clears the
 * threshold:
 *
 *   defend  bring crews home to a threatened plaza
 *   raid    attack a weak rival plaza within reach
 *   ambush  wait on a road where rival traffic has been seen
 *   scout   send a small crew to lie low inside a rival plaza it knows little about
 *   commit  put crews in Culiacán into a contested colonia
 *
 * Each is scored as value × trait weight × goal weight − risk × caution, using
 * only what the character's network believes. Housekeeping (recalling stale
 * ambushes and scouts) always runs. Neutral characters also decide whether to
 * pick a side.
 */
import type { AiAction } from '../../data/schemas';
import { rivalPlazaIds, type Command } from '../commands';
import type { SimContext } from '../context';
import { groupOf, sortedCrewIds } from '../crews';
import { crewNetwork, networkOf, ownedBy } from '../network';
import { opinionOf } from '../opinion';
import { groupPower } from '../power';
import { chance } from '../rng';
import { travelHours } from '../routing';
import type { CrewState, FactionRequest, Id, NetworkId } from '../state';
import { nodeValue } from '../systems/economy';
import { truceBetween } from '../pacts';
import { world } from '../world';
import { onDuty } from '../requests';
import type { Intel } from './intel';
import { activeOffensive, contestedColonia, detachable, threats } from './strategic';
import { actionWeight, cautionOf, isAi, preferenceFor, stagger } from './util';

interface Option {
  action: AiAction;
  score: number;
  commands: Command[];
}

export function runOperational(ctx: SimContext, intel: Intel): Command[] {
  const { state, content } = ctx;
  const every = content.tuning.ai.operationalIntervalHours;
  const cmds: Command[] = [];
  const owners = new Set(Object.values(state.crews).map((c) => c.owner));
  for (const id of Object.keys(state.characters).sort()) {
    if (!isAi(state, id)) continue;
    if ((state.hour + stagger(`op:${id}`, every)) % every !== 0) continue;
    const mine = sortedCrewIds(state)
      .map((c) => state.crews[c]!)
      .filter((c) => c.owner === id);
    cmds.push(...answerRequests(ctx, id, mine));
    if (state.characters[id]!.faction === null) cmds.push(...considerSide(ctx, intel, id));
    if (!owners.has(id)) continue;
    cmds.push(...housekeeping(ctx, id, mine));
    const best = initiatives(ctx, intel, id, mine)
      .filter((o) => o.score >= content.tuning.ai.operational.actThreshold)
      .sort((a, b) => b.score - a.score)[0];
    if (best) cmds.push(...best.commands);
  }
  return cmds;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function answerRequests(ctx: SimContext, id: Id, mine: CrewState[]): Command[] {
  const { state, content } = ctx;
  const t = content.tuning.ai.requests;
  const cmds: Command[] = [];
  for (const r of state.requests.filter((x) => x.to === id && x.status === 'pending')) {
    const base = t.acceptBase + opinionOf(state, content, id, r.from) * t.opinionWeight;
    let p = base * actionWeight(state, content, id, 'accept_request');
    if (r.kind === 'levy') p *= 0.8;
    const usable = requestedCrews(ctx, r, mine);
    if (r.kind !== 'levy' && usable.length === 0) p = 0;
    const accept = chance(state.rng, Math.max(0.02, Math.min(0.98, p)));
    cmds.push({ type: 'respond_request', issuer: id, request: r.id, accept });
    if (!accept) continue;
    for (const c of usable) {
      if (r.kind === 'join_offensive' && r.target) {
        cmds.push({ type: 'order_crew', issuer: id, crew: c.id, order: { type: 'raid', target: r.target, preference: preferenceFor(ctx, c.leader), arriveAt: r.arriveBy, avoidRivalPlazas: true } });
      } else if ((r.kind === 'defend' || r.kind === 'hold_colonia') && r.target) {
        const dest = r.kind === 'hold_colonia' ? content.culiacan.parentNode : r.target;
        cmds.push({ type: 'order_crew', issuer: id, crew: c.id, order: { type: 'move', destination: dest, preference: 'fastest', avoidRivalPlazas: true } });
      }
    }
  }
  return cmds;
}

/** The requested crews that are still free to go (or, failing that, any free crew). */
function requestedCrews(ctx: SimContext, r: FactionRequest, mine: CrewState[]): CrewState[] {
  const free = mine.filter((c) => c.battle === null && c.colonia === null && (c.order.type === 'garrison' || c.order.type === 'idle'));
  const named = free.filter((c) => r.crews.includes(c.id));
  if (named.length || r.kind === 'levy') return named;
  return free.slice(0, 1);
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

function housekeeping(ctx: SimContext, id: Id, mine: CrewState[]): Command[] {
  const { state, content } = ctx;
  const op = content.tuning.ai.operational;
  const cmds: Command[] = [];
  for (const c of mine) {
    if (c.battle !== null) continue;
    const o = c.order;
    const stale =
      (o.type === 'ambush' && state.hour - (o.since ?? state.hour) > op.ambushMaxHours) ||
      (o.type === 'patrol' && state.hour - (o.since ?? state.hour) > op.ambushMaxHours) ||
      (o.type === 'lie_low' && c.location.kind === 'node' && !ownedBy(state, c.location.node, crewNetwork(state, c)) && state.hour - (o.since ?? state.hour) > op.scoutHoldHours);
    if (stale) cmds.push({ type: 'order_crew', issuer: id, crew: c.id, order: { type: 'retreat' } });
    // A scout whose hiding place has since fallen to its own side simply takes up the garrison.
    else if (o.type === 'lie_low' && c.location.kind === 'node' && ownedBy(state, c.location.node, crewNetwork(state, c)))
      cmds.push({ type: 'order_crew', issuer: id, crew: c.id, order: { type: 'garrison' } });
  }
  return cmds;
}

// ---------------------------------------------------------------------------
// Initiatives
// ---------------------------------------------------------------------------

function initiatives(ctx: SimContext, intel: Intel, id: Id, mine: CrewState[]): Option[] {
  const { state, content } = ctx;
  const net = networkOf(state, id);
  const fs = state.factions[net];
  const exhausted =
    (fs ? fs.exhaustion >= content.tuning.pulse.allOffensivesHaltAtExhaustion : false) || state.hour < content.tuning.ai.operational.firstInitiativeDay * 24;
  const free = mine.filter(
    (c) => c.battle === null && c.colonia === null && c.location.kind === 'node' && (c.order.type === 'garrison' || c.order.type === 'idle') && !onDuty(state, c.id),
  );
  const options: Option[] = [];
  options.push(...defendOptions(ctx, intel, id, net, mine));
  if (!exhausted) {
    options.push(...raidOptions(ctx, intel, id, net, free));
    options.push(...ambushOptions(ctx, intel, id, net, free));
    options.push(...scoutOptions(ctx, intel, id, net, free));
  }
  options.push(...coloniaOptions(ctx, id, net, mine));
  return options;
}

function defendOptions(ctx: SimContext, intel: Intel, id: Id, net: NetworkId, mine: CrewState[]): Option[] {
  const { state, content } = ctx;
  const out: Option[] = [];
  for (const t of threats(ctx, intel, net)) {
    if (state.nodes[t.node]!.owner !== id) continue;
    const away = mine.filter(
      (c) => c.battle === null && c.colonia === null && !(c.location.kind === 'node' && c.location.node === t.node) && (c.order.type === 'garrison' || c.order.type === 'idle'),
    );
    if (!away.length) continue;
    const severity = t.enemy / Math.max(1, t.garrison);
    out.push({
      action: 'defend',
      score: Math.min(4, severity) * actionWeight(state, content, id, 'defend'),
      commands: away.map((c) => ({ type: 'order_crew', issuer: id, crew: c.id, order: { type: 'move', destination: t.node, preference: 'fastest', avoidRivalPlazas: true } })),
    });
  }
  return out;
}

function raidOptions(ctx: SimContext, intel: Intel, id: Id, net: NetworkId, free: CrewState[]): Option[] {
  const { state, content } = ctx;
  const op = content.tuning.ai.operational;
  const ch = state.characters[id]!;
  const fs = state.factions[net];
  const sendable = detachable(ctx, net, free);
  if (!sendable.length) return [];
  // A faction offensive in progress takes priority over private raids near it.
  const offensive = fs ? activeOffensive(ctx, net) : undefined;
  const caution = cautionOf(state, content, id);
  const out: Option[] = [];
  const hours = new Map(sendable.map((c) => [c.id, travelHours(state, content, { crews: groupOf(state, c), from: c.location, preference: 'fastest', departHour: state.hour, viewer: net, noPassThrough: rivalPlazaIds(state, net) })]));
  for (const n of content.nodes) {
    const owner = state.nodes[n.id]!.owner;
    if (!owner || networkOf(state, owner) === net || n.type === 'border_exit' || n.id === content.culiacan.parentNode) continue;
    if (offensive && offensive.target === n.id) continue;
    if (truceBetween(state, net, networkOf(state, owner), n.region)) continue;
    const force = sendable.filter((c) => (hours.get(c.id)!.get(n.id) ?? Infinity) <= op.raidMaxHours);
    if (!force.length) continue;
    const power = groupPower(state, content, force.flatMap((c) => groupOf(state, c)));
    const est = intel.defense(net, n.id);
    if (power < op.raidMinRatio * est.power) continue;
    let value = nodeValue(state, content, n.id) / op.raidValuePerPoint;
    if (ch.relations.some((r) => r.target === owner && (r.type === 'rival' || r.type === 'vendetta'))) value *= op.relationTargetBonus;
    if (fs?.warPlan.focusRegion === n.region) value *= op.focusRegionBonus;
    const risk = (est.power / Math.max(1, power)) * op.raidRiskPenalty * caution + (est.known ? 0 : 0.5 * caution);
    const score = value * actionWeight(state, content, id, 'raid') - risk;
    const arriveAt = state.hour + Math.ceil(Math.max(...force.map((c) => hours.get(c.id)!.get(n.id)!))) + 1;
    out.push({
      action: 'raid',
      score,
      commands: force.map((c) => ({ type: 'order_crew', issuer: id, crew: c.id, order: { type: 'raid', target: n.id, preference: preferenceFor(ctx, c.leader), arriveAt, avoidRivalPlazas: true } })),
    });
  }
  return out;
}

function ambushOptions(ctx: SimContext, intel: Intel, id: Id, net: NetworkId, free: CrewState[]): Option[] {
  const { state, content } = ctx;
  const op = content.tuning.ai.operational;
  const w = world(content);
  const sendable = detachable(ctx, net, free);
  const out: Option[] = [];
  for (const c of sendable) {
    const node = (c.location as { node: Id }).node;
    if (state.nodes[node]!.owner !== id) continue;
    for (const nb of w.neighbors(node)) {
      if (!content.tuning.vehicles.pickup.roads.includes(nb.road.type)) continue;
      const traffic = intel.believedOnRoad(net, nb.road.id).filter((b) => state.hour - b.hour <= op.ambushRecentHours && networkOf(state, b.owner) !== net).length;
      if (!traffic) continue;
      out.push({
        action: 'ambush',
        score: traffic * op.ambushTrafficValue * actionWeight(state, content, id, 'ambush'),
        commands: [{ type: 'order_crew', issuer: id, crew: c.id, order: { type: 'ambush', road: nb.road.id } }],
      });
    }
  }
  return out;
}

function scoutOptions(ctx: SimContext, intel: Intel, id: Id, net: NetworkId, free: CrewState[]): Option[] {
  const { state, content } = ctx;
  const op = content.tuning.ai.operational;
  const fs = state.factions[net];
  const target = fs?.warPlan.target;
  if (!target || ownedBy(state, target, net)) return [];
  const est = intel.defense(net, target);
  if (est.known && est.age <= op.scoutStaleHours) return [];
  const scout = detachable(ctx, net, free)
    .filter((c) => c.men <= op.scoutMaxMen)
    .map((c) => ({ c, h: travelHours(state, content, { crews: groupOf(state, c), from: c.location, preference: 'safest', departHour: state.hour, viewer: net, noPassThrough: rivalPlazaIds(state, net).filter((n) => n !== target) }).get(target) ?? Infinity }))
    .filter((x) => x.h <= op.raidMaxHours)
    .sort((a, b) => a.h - b.h || (a.c.id < b.c.id ? -1 : 1))[0];
  if (!scout) return [];
  return [
    {
      action: 'scout',
      score: op.scoutValue * actionWeight(state, content, id, 'scout'),
      commands: [{ type: 'order_crew', issuer: id, crew: scout.c.id, order: { type: 'move', destination: target, preference: 'safest', onArrive: 'lie_low', avoidRivalPlazas: true } }],
    },
  ];
}

function coloniaOptions(ctx: SimContext, id: Id, net: NetworkId, mine: CrewState[]): Option[] {
  const { state, content } = ctx;
  const op = content.tuning.ai.operational;
  const city = content.culiacan.parentNode;
  if (!state.factions[net]) return [];
  const idle = mine.filter((c) => c.location.kind === 'node' && c.location.node === city && c.colonia === null && c.battle === null && c.order.type !== 'escort');
  if (!idle.length) return [];
  const target = contestedColonia(ctx, net);
  if (!target) return [];
  return [
    {
      action: 'commit_colonia',
      score: op.colonia.value * actionWeight(state, content, id, 'commit_colonia'),
      commands: idle.slice(0, op.colonia.maxCrews).map((c) => ({ type: 'deploy_crew', issuer: id, crew: c.id, colonia: target })),
    },
  ];
}

// ---------------------------------------------------------------------------
// Neutrals
// ---------------------------------------------------------------------------

/** A neutral declares for the side it leans to when threatened, or now and then as the war drags on. */
function considerSide(ctx: SimContext, intel: Intel, id: Id): Command[] {
  const { state, content } = ctx;
  const op = content.tuning.ai.operational;
  const ch = state.characters[id]!;
  const leans = Object.entries(ch.factionOpinions)
    .map(([f, mods]) => ({ f, v: mods.reduce((n, m) => n + m.value, 0) }))
    .filter((x) => content.factions.some((fx) => fx.id === x.f && fx.kind === 'major'))
    .sort((a, b) => b.v - a.v || (a.f < b.f ? -1 : 1))[0];
  if (!leans || leans.v < op.neutralDeclareMinLean) return [];
  const threatened = threats(ctx, intel, id).length > 0;
  if (threatened || chance(state.rng, op.neutralDeclareChancePerCheck)) return [{ type: 'declare_alignment', issuer: id, faction: leans.f }];
  return [];
}
