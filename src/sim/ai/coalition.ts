/**
 * The AI's coalition politics (GDD "Coalition warfare"): answering joint
 * operation invitations (yes with crews, no with a reason, or a counter-offer),
 * proposing joint attacks and asking neighbors for help holding a plaza,
 * accepting counters, and answering and offering pacts. Everything goes
 * through commands, and judgments come from the AI's own side's reports.
 */
import type { Command } from '../commands';
import type { SimContext } from '../context';
import { groupOf } from '../crews';
import { cashOf } from '../money';
import { networkOf, ownedBy } from '../network';
import { committedCrews, onOperation } from '../operations';
import { opinionOf } from '../opinion';
import { pactBetween, pactBlocked } from '../pacts';
import { groupPower } from '../power';
import { onDuty } from '../requests';
import { chance, rand } from '../rng';
import { travelHours } from '../routing';
import type { CrewState, Id, JointOp, OpInvite, PactOffer } from '../state';
import { nodeValue } from '../systems/economy';
import { world } from '../world';
import { withinHops, type Intel } from './intel';
import { detachable, personalCrew, threats } from './strategic';
import { actionWeight, cautionOf, isAi, stagger } from './util';
import { rivalPlazaIds } from '../commands';

export function runCoalition(ctx: SimContext, intel: Intel): Command[] {
  const { state } = ctx;
  const cmds: Command[] = [];
  for (const op of state.operations) {
    if (op.status !== 'planning') continue;
    for (const inv of op.invites) {
      if (inv.status !== 'pending' || !isAi(state, inv.to)) continue;
      if (state.hour - op.createdAt < ctx.content.tuning.coalition.aiAnswerDelayHours) continue;
      cmds.push(answerInvite(ctx, intel, op, inv));
    }
    if (isAi(state, op.proposer)) {
      for (const inv of op.invites) if (inv.status === 'countered' && acceptableCounter(ctx, op, inv)) cmds.push({ type: 'accept_counter', issuer: op.proposer, op: op.id, invitee: inv.to });
    }
  }
  for (const offer of state.pactOffers) if (isAi(state, offer.to)) cmds.push({ type: 'respond_pact', issuer: offer.to, offer: offer.id, accept: pactScore(ctx, offer) >= ctx.content.tuning.coalition.pacts.ai.threshold[offer.type] });
  // Once a day per AI boss: propose something.
  for (const id of Object.keys(state.characters).sort()) {
    if (!isAi(state, id) || state.characters[id]!.faction === null) continue;
    if ((state.hour + stagger(`coalition:${id}`, 24)) % 24 !== 0) continue;
    const c = propose(ctx, intel, id);
    if (c) cmds.push(c);
  }
  return cmds;
}

// ---------------------------------------------------------------------------
// Crews a boss can offer
// ---------------------------------------------------------------------------

interface Offer {
  crew: CrewState;
  hours: number;
}

/** A boss's crews that can leave and reach `target` within `maxHours`, nearest first. */
function availableCrews(ctx: SimContext, id: Id, target: Id, maxHours: number): Offer[] {
  const { state, content } = ctx;
  const net = networkOf(state, id);
  const personal = state.factions[net]?.head === id ? personalCrew(state, id) : null;
  const free = Object.keys(state.crews)
    .sort()
    .map((cid) => state.crews[cid]!)
    .filter(
      (c) =>
        c.owner === id &&
        c.id !== personal &&
        c.battle === null &&
        c.colonia === null &&
        c.location.kind === 'node' &&
        (c.order.type === 'garrison' || c.order.type === 'idle') &&
        !onDuty(state, c.id) &&
        !onOperation(state, c.id),
    );
  const out: Offer[] = [];
  for (const c of detachable(ctx, net, free)) {
    if (c.location.kind === 'node' && c.location.node === target) {
      out.push({ crew: c, hours: 0 });
      continue;
    }
    const h = travelHours(state, content, { crews: groupOf(state, c), from: c.location, preference: 'fastest', departHour: state.hour, viewer: net, noPassThrough: rivalPlazaIds(state, net).filter((n) => n !== target) }).get(target);
    if (h !== undefined && h <= maxHours) out.push({ crew: c, hours: h });
  }
  return out.sort((a, b) => a.hours - b.hours || (a.crew.id < b.crew.id ? -1 : 1));
}

const power = (ctx: SimContext, crews: CrewState[]) => groupPower(ctx.state, ctx.content, crews.flatMap((c) => groupOf(ctx.state, c)));

// ---------------------------------------------------------------------------
// Answering invitations
// ---------------------------------------------------------------------------

function answerInvite(ctx: SimContext, intel: Intel, op: JointOp, inv: OpInvite): Command {
  const { state, content } = ctx;
  const t = content.tuning.coalition;
  const a = t.ai;
  const me = inv.to;
  const net = networkOf(state, me);
  const w = world(content);
  const no = (reason: string): Command => ({ type: 'respond_operation', issuer: me, op: op.id, accept: false, reason });
  const name = (n: Id) => w.node(n).name;

  const home = threats(ctx, intel, net).find((x) => state.nodes[x.node]?.owner === me && x.node !== op.target);
  if (home) return no(`needs his men home: rival crews near ${name(home.node)}`);
  const offers = availableCrews(ctx, me, op.target, Math.min(t.inviteMaxTravelHours, op.strikeAt - state.hour));
  if (!offers.length) return no('has no crews that can get there in time');

  const opinion = opinionOf(state, content, me, op.proposer);
  const caution = cautionOf(state, content, me);
  let picked: CrewState[];
  let score: number;
  let plazaPart = 0;
  if (op.kind === 'attack') {
    const est = intel.defense(net, op.target);
    const already = committedCrews(state, op);
    const need = est.power * a.minRatio;
    picked = [];
    for (const o of offers) {
      if (power(ctx, [...already, ...picked]) >= need * a.commitOvershoot) break;
      picked.push(o.crew);
    }
    if (power(ctx, [...already, ...picked]) < need) return no(`does not think it can work: about ${est.men} defenders`);
    const myMen = picked.reduce((n, c) => n + c.men, 0);
    const allMen = [...already, ...picked].reduce((n, c) => n + c.men, 0);
    const share = op.plaza === me ? 1 : op.plaza === 'contribution' ? myMen / Math.max(1, allMen) : 0;
    const value = nodeValue(state, content, op.target);
    plazaPart = (value / a.valuePerPoint) * actionWeight(state, content, me, 'raid');
    const income = (inv.incomeShare * value * 7 * inv.incomeWeeks) / a.cashPerPoint;
    score = (plazaPart * share + inv.cash / a.cashPerPoint + income + opinion * a.opinionWeight) * actionWeight(state, content, me, 'accept_request') - est.power * a.riskPenalty * caution;
    if (score < a.threshold && op.plaza !== me && share < 1) {
      const withPlaza = score + plazaPart * (1 - share) * actionWeight(state, content, me, 'accept_request');
      if (withPlaza >= a.threshold && !op.invites.some((i) => i.status === 'accepted' && i.counter?.plaza)) {
        return { type: 'respond_operation', issuer: me, op: op.id, accept: false, counter: { plaza: true, cash: 0 }, crews: picked.map((c) => c.id), reason: 'wants the plaza' };
      }
    }
  } else {
    picked = offers.slice(0, a.defendCrews).map((o) => o.crew);
    const threat = threats(ctx, intel, net).find((x) => x.node === op.target);
    score = (a.defendBase + inv.cash / a.cashPerPoint + opinion * a.opinionWeight) * actionWeight(state, content, me, 'defend') - (threat?.enemy ?? 0) * a.riskPenalty * caution;
  }
  if (score >= a.threshold) return { type: 'respond_operation', issuer: me, op: op.id, accept: true, crews: picked.map((c) => c.id) };
  const cash = Math.ceil(((a.threshold - score) * a.cashPerPoint) / Math.max(0.1, actionWeight(state, content, me, 'accept_request')) / 5000) * 5000;
  if (cash <= a.maxCounterCash) return { type: 'respond_operation', issuer: me, op: op.id, accept: false, counter: { plaza: false, cash }, crews: picked.map((c) => c.id), reason: `wants $${cash.toLocaleString()}` };
  return no('it is not worth it for him');
}

/** An AI proposer takes a counter if it can afford it and still wants the plan. */
function acceptableCounter(ctx: SimContext, op: JointOp, inv: OpInvite): boolean {
  const { state, content } = ctx;
  const c = inv.counter;
  if (!c) return false;
  const a = content.tuning.coalition.ai;
  if (c.plaza) return op.plaza !== 'proposer' || actionWeight(state, content, op.proposer, 'raid') < a.plazaCounterMaxRaidWeight;
  return c.cash <= a.maxCounterCash && c.cash <= cashOf(state, op.proposer) * a.counterMaxCashShare;
}

// ---------------------------------------------------------------------------
// Pacts
// ---------------------------------------------------------------------------

function pactScore(ctx: SimContext, offer: PactOffer): number {
  const { state, content } = ctx;
  const p = content.tuning.coalition.pacts.ai;
  const me = offer.to;
  let score = opinionOf(state, content, me, offer.from) / p.opinionPerPoint + offer.cash / p.cashPerPoint;
  const mine = (id: Id) => Object.values(state.crews).filter((c) => c.owner === id).reduce((n, c) => n + c.men, 0);
  switch (offer.type) {
    case 'non_aggression':
      if (mine(me) < mine(offer.from) * p.weakerRatio) score += p.weakerBonus;
      break;
    case 'local_truce': {
      const f = state.characters[me]?.faction;
      score += ((f ? state.factions[f]?.exhaustion : 0) ?? 0) / 10 * p.exhaustionPer10;
      break;
    }
    case 'route_share': {
      const route = content.routes.find((r) => r.id === offer.route);
      score += route ? (route.dailyValue * offer.share * 7) / p.cashPerPoint : 0;
      break;
    }
    default:
      break;
  }
  return score;
}

// ---------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------

function propose(ctx: SimContext, intel: Intel, id: Id): Command | null {
  const { state, content } = ctx;
  const t = content.tuning.coalition;
  const me = state.characters[id]!;
  const net = networkOf(state, id);
  if (state.operations.some((o) => o.status === 'planning' && o.proposer === id)) return null;
  const peers = Object.keys(state.characters)
    .sort()
    .filter((p) => p !== id && state.characters[p]!.faction === me.faction && state.characters[p]!.outsider === null && state.characters[p]!.status === 'free');

  // Ask for help holding a threatened plaza.
  const threat = threats(ctx, intel, net).find((x) => state.nodes[x.node]?.owner === id);
  if (threat && chance(state.rng, t.ai.defendProposeDailyChance * actionWeight(state, content, id, 'defend'))) {
    const helpers = peers
      .map((p) => ({ p, men: availableCrews(ctx, p, threat.node, t.inviteMaxTravelHours).reduce((n, o) => n + o.crew.men, 0) }))
      .filter((x) => x.men > 0)
      .sort((x, y) => y.men - x.men || (x.p < y.p ? -1 : 1))
      .slice(0, 3);
    if (helpers.length) {
      const strikeAt = state.hour + Math.max(t.minLeadHours, t.ai.defendLeadHours);
      return { type: 'propose_operation', issuer: id, kind: 'defend', target: threat.node, strikeAt, holdUntil: strikeAt + t.ai.defendHoldHours, plaza: 'proposer', crews: [], invites: helpers.map((h) => ({ to: h.p })) };
    }
  }

  // A rival plaza too strong to take alone, but not with neighbors.
  if (!chance(state.rng, t.ai.proposeDailyChance * actionWeight(state, content, id, 'raid'))) return maybePact(ctx, id, peers);
  const s = content.tuning.ai.operational;
  let best: { target: Id; mine: CrewState[]; helpers: Id[]; arrive: number; value: number } | null = null;
  for (const n of content.nodes) {
    const owner = state.nodes[n.id]!.owner;
    if (!owner || ownedBy(state, n.id, net) || n.type === 'border_exit' || n.id === content.culiacan.parentNode) continue;
    if (pactBetween(state, id, owner, 'non_aggression')) continue;
    const est = intel.defense(net, n.id);
    const mine = availableCrews(ctx, id, n.id, t.inviteMaxTravelHours);
    if (!mine.length) continue;
    const myPower = power(ctx, mine.map((o) => o.crew));
    if (myPower >= est.power * s.raidMinRatio) continue; // can do it alone
    const helpers = peers
      .map((p) => ({ p, offers: availableCrews(ctx, p, n.id, t.inviteMaxTravelHours) }))
      .filter((x) => x.offers.length)
      .sort((x, y) => power(ctx, y.offers.map((o) => o.crew)) - power(ctx, x.offers.map((o) => o.crew)) || (x.p < y.p ? -1 : 1))
      .slice(0, 3);
    const total = myPower + helpers.reduce((n2, h) => n2 + power(ctx, h.offers.map((o) => o.crew)), 0);
    if (total < est.power * t.ai.minRatio) continue;
    const value = nodeValue(state, content, n.id);
    const arrive = Math.max(...mine.map((o) => o.hours), ...helpers.flatMap((h) => h.offers.map((o) => o.hours)));
    if (!best || value > best.value) best = { target: n.id, mine: mine.map((o) => o.crew), helpers: helpers.map((h) => h.p), arrive, value };
  }
  if (!best) return null;
  const strikeAt = state.hour + Math.min(t.maxLeadHours, Math.max(t.minLeadHours, Math.ceil(best.arrive) + t.aiAnswerDelayHours + t.ai.slackHours));
  return {
    type: 'propose_operation',
    issuer: id,
    kind: 'attack',
    target: best.target,
    strikeAt,
    plaza: 'contribution',
    crews: best.mine.map((c) => c.id),
    invites: best.helpers.map((p) => ({ to: p })),
  };
}

/** Now and then: offer mutual defense to a friendly neighbor on the same side. */
function maybePact(ctx: SimContext, id: Id, peers: Id[]): Command | null {
  const { state, content } = ctx;
  const p = content.tuning.coalition.pacts;
  if (!chance(state.rng, p.ai.proposeDailyChance)) return null;
  const mine = Object.values(state.nodes).filter((n) => n.owner === id).map((n) => n.id);
  const near = peers.filter((q) => {
    if (opinionOf(state, content, q, id) < p.ai.minOpinionToOffer) return false;
    return Object.values(state.nodes).some((n) => n.owner === q && mine.some((m) => withinHops(content, m, 2).has(n.id)));
  });
  if (!near.length) return null;
  const to = near[Math.floor(rand(state.rng) * near.length)]!;
  const spec = { to, pact: 'mutual_defense' as const, days: p.defaultDays * 3 };
  return pactBlocked(state, content, id, spec) === null ? { type: 'propose_pact', issuer: id, ...spec } : null;
}
