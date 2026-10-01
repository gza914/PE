/**
 * Joint operations between bosses (GDD "Coalition warfare"). A peer proposal,
 * not an order: invitees answer yes (with crews), no (with a reason), or a
 * counter-offer, and refusing costs nothing. What people remember is agreeing
 * and then not showing up.
 *
 * Attack: everyone arrives at the target at the strike hour. If the plaza
 * falls, it goes by the agreed rule, else by contribution (combat.ts).
 * Defend: everyone holds an ally's plaza from the strike hour until the end.
 *
 * Plans can leak to the defenders: more participants leak more, sharp ones
 * (Astucia) less.
 */
import { orderCrew, type OrderRequest } from './commands';
import { newId, pushFeed, tellSide, type SimContext } from './context';
import { groupOf } from './crews';
import { cashOf, deposit, spend } from './money';
import { networkOf } from './network';
import { addOpinion } from './opinion';
import { charName } from './orders';
import { chance } from './rng';
import type { CrewState, GameState, Id, JointOp, OpInvite, OpKind } from './state';
import { world } from './world';
import { report } from './systems/detection';

/** A planning attack on `node` by `net` whose strike window covers now (used when the plaza falls). */
export function opForCapture(state: GameState, node: Id, net: Id, earlyHours: number): JointOp | null {
  return (
    state.operations.find(
      (o) => o.status === 'planning' && o.kind === 'attack' && o.target === node && networkOf(state, o.proposer) === net && state.hour >= o.strikeAt - earlyHours,
    ) ?? null
  );
}

/** Crews committed to a joint operation still being planned or carried out. */
export function onOperation(state: GameState, crew: Id): boolean {
  return state.operations.some((o) => o.status === 'planning' && (o.crews.includes(crew) || o.invites.some((i) => i.status === 'accepted' && i.crews.includes(crew))));
}

function participants(op: JointOp): Id[] {
  return [op.proposer, ...op.invites.filter((i) => i.status === 'accepted').map((i) => i.to)];
}

export function committedCrews(state: GameState, op: JointOp): CrewState[] {
  const ids = [...op.crews, ...op.invites.filter((i) => i.status === 'accepted').flatMap((i) => i.crews)];
  return ids.map((id) => state.crews[id]).filter((c): c is CrewState => !!c);
}

function placeName(ctx: SimContext, node: Id): string {
  return world(ctx.content).node(node).name;
}

/** The order that takes a committed crew to the operation. */
function opOrder(op: JointOp): OrderRequest {
  return op.kind === 'attack'
    ? { type: 'raid', target: op.target, preference: 'balanced', arriveAt: op.strikeAt, avoidRivalPlazas: true }
    : { type: 'move', destination: op.target, preference: 'fastest', arriveAt: op.strikeAt, avoidRivalPlazas: true };
}

function sendCrews(ctx: SimContext, op: JointOp, owner: Id, crews: Id[]): string | null {
  for (const id of crews) {
    const c = ctx.state.crews[id];
    if (!c || c.owner !== owner) return 'one of those crews is not yours';
    // Already there for a defense: just stay.
    if (op.kind === 'defend' && c.location.kind === 'node' && c.location.node === op.target) {
      c.order = { type: 'garrison' };
      continue;
    }
    const err = orderCrew(ctx, c, opOrder(op));
    if (err) return `${charName(ctx, c.leader)}'s crew: ${err}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface ProposeSpec {
  kind: OpKind;
  target: Id;
  strikeAt: number;
  holdUntil?: number | null;
  plaza: 'proposer' | 'contribution' | Id;
  crews: Id[];
  invites: { to: Id; cash?: number; incomeShare?: number; incomeWeeks?: number }[];
}

export function proposeOperation(ctx: SimContext, issuer: Id, spec: ProposeSpec): string | null {
  const { state, content } = ctx;
  const t = content.tuning.coalition;
  const me = state.characters[issuer]!;
  const net = networkOf(state, issuer);
  const node = state.nodes[spec.target];
  if (!node) return `unknown plaza "${spec.target}"`;
  if (!me.faction) return 'joint operations are between bosses on the same side; neutrals have no partners';
  const def = world(content).node(spec.target);
  if (def.type === 'border_exit' || spec.target === content.culiacan.parentNode) return `${def.name} cannot be the target of a joint operation`;
  if (spec.kind === 'attack' && (!node.owner || networkOf(state, node.owner) === net)) return 'attack a plaza the other side holds';
  if (spec.kind === 'defend' && (!node.owner || networkOf(state, node.owner) !== net)) return 'you can only ask for help holding your own side’s plaza';
  const lead = spec.strikeAt - state.hour;
  if (!Number.isInteger(spec.strikeAt) || lead < t.minLeadHours || lead > t.maxLeadHours) return `set the strike between ${t.minLeadHours} and ${t.maxLeadHours} hours from now`;
  const holdUntil = spec.kind === 'defend' ? (spec.holdUntil ?? null) : null;
  if (spec.kind === 'defend' && (holdUntil === null || holdUntil <= spec.strikeAt || holdUntil - spec.strikeAt > 24 * 14)) return 'hold for between an hour and two weeks after everyone arrives';
  if (!spec.invites.length || spec.invites.length > t.maxInvites) return `invite between 1 and ${t.maxInvites} bosses`;
  const seen = new Set<Id>();
  for (const inv of spec.invites) {
    const c = state.characters[inv.to];
    if (!c || inv.to === issuer || seen.has(inv.to)) return 'invalid or repeated invitee';
    if (c.status !== 'free') return `${charName(ctx, inv.to)} is ${c.status}`;
    if (c.faction !== me.faction) return `${charName(ctx, inv.to)} is not on your side`;
    if (c.outsider !== null) return `${charName(ctx, inv.to)} deals only as an outside cartel`;
    if ((inv.cash ?? 0) < 0 || (inv.incomeShare ?? 0) < 0 || (inv.incomeShare ?? 0) > 0.5 || (inv.incomeWeeks ?? 0) < 0) return 'invalid offer';
    seen.add(inv.to);
  }
  if (spec.plaza !== 'proposer' && spec.plaza !== 'contribution' && !seen.has(spec.plaza)) return 'the plaza can go to you, an invitee, or whoever contributes most';
  if (state.operations.some((o) => o.status === 'planning' && o.proposer === issuer && o.target === spec.target)) return 'you already have an operation planned there';
  for (const id of spec.crews) {
    const c = state.crews[id];
    if (!c || c.owner !== issuer) return 'you can only commit your own crews';
    if (onOperation(state, id)) return `${charName(ctx, c.leader)}'s crew is already committed to another operation`;
  }
  const op: JointOp = {
    id: newId(state, 'op'),
    kind: spec.kind,
    proposer: issuer,
    target: spec.target,
    strikeAt: spec.strikeAt,
    holdUntil,
    plaza: spec.plaza,
    crews: [...spec.crews],
    invites: spec.invites.map((i) => ({
      to: i.to,
      status: 'pending',
      cash: Math.floor(i.cash ?? 0),
      incomeShare: i.incomeShare ?? 0,
      incomeWeeks: Math.floor(i.incomeWeeks ?? 0),
      crews: [],
      reason: null,
      counter: null,
      answeredAt: null,
    })),
    status: 'planning',
    createdAt: state.hour,
    leaked: false,
    result: null,
    fought: [],
  };
  const err = sendCrews(ctx, op, issuer, op.crews);
  if (err) return err;
  state.operations.push(op);
  const what = op.kind === 'attack' ? `a joint attack on ${placeName(ctx, op.target)}` : `help holding ${placeName(ctx, op.target)}`;
  for (const inv of op.invites) {
    if (inv.to === state.playerId) pushFeed(state, 'critical', `${charName(ctx, issuer)} proposes ${what}, everyone there by day ${Math.floor(op.strikeAt / 24)} at ${op.strikeAt % 24}:00. Answer in the Diplomacy tab.`, op.target, networkOf(state, inv.to));
  }
  return null;
}

export interface RespondSpec {
  op: Id;
  accept: boolean;
  crews?: Id[];
  counter?: { plaza: boolean; cash: number } | null;
  reason?: string | null;
}

export function respondOperation(ctx: SimContext, issuer: Id, spec: RespondSpec): string | null {
  const { state } = ctx;
  const op = state.operations.find((o) => o.id === spec.op);
  if (!op || op.status !== 'planning') return 'that operation is no longer being planned';
  const inv = op.invites.find((i) => i.to === issuer);
  if (!inv) return 'you were not invited';
  if (inv.status !== 'pending') return `you already answered (${inv.status})`;
  inv.answeredAt = state.hour;
  if (spec.counter && (spec.counter.plaza || spec.counter.cash > 0)) {
    inv.status = 'countered';
    inv.counter = { plaza: spec.counter.plaza, cash: Math.max(0, Math.floor(spec.counter.cash)) };
    inv.crews = [...(spec.crews ?? [])];
    inv.reason = spec.reason ?? null;
    if (op.proposer === state.playerId) {
      const want = inv.counter.plaza ? 'the plaza' : `$${inv.counter.cash.toLocaleString()}`;
      pushFeed(state, 'important', `${charName(ctx, issuer)} will join the operation on ${placeName(ctx, op.target)} for ${want}.`, op.target, networkOf(state, op.proposer));
    }
    return null;
  }
  if (!spec.accept) {
    inv.status = 'declined';
    inv.reason = spec.reason ?? null;
    if (op.proposer === state.playerId) {
      pushFeed(state, 'routine', `${charName(ctx, issuer)} will not join the operation on ${placeName(ctx, op.target)}${inv.reason ? `: ${inv.reason}` : '.'}`, op.target, networkOf(state, op.proposer));
    }
    return null;
  }
  return commit(ctx, op, inv, spec.crews ?? []);
}

function commit(ctx: SimContext, op: JointOp, inv: OpInvite, crews: Id[]): string | null {
  const { state, content } = ctx;
  if (!crews.length) return 'commit at least one crew';
  for (const id of crews) {
    const c = state.crews[id];
    if (!c || c.owner !== inv.to) return 'you can only commit your own crews';
    if (onOperation(state, id)) return `${charName(ctx, c.leader)}'s crew is already committed elsewhere`;
  }
  const cash = inv.cash + (inv.counter?.cash ?? 0);
  if (cash > 0 && cashOf(state, op.proposer) < cash) {
    inv.status = 'declined';
    inv.reason = `${charName(ctx, op.proposer)} could not pay the $${cash.toLocaleString()} offered`;
    return null;
  }
  const err = sendCrews(ctx, op, inv.to, crews);
  if (err) return err;
  if (cash > 0) {
    spend(state, content, op.proposer, cash, 'deals');
    deposit(state, content, inv.to, cash, 'deals');
  }
  inv.status = 'accepted';
  inv.crews = [...crews];
  if (inv.counter?.plaza) op.plaza = inv.to;
  const men = crews.reduce((n, id) => n + (state.crews[id]?.men ?? 0), 0);
  if (op.proposer === state.playerId) pushFeed(state, 'important', `${charName(ctx, inv.to)} is in: ${men} men for ${placeName(ctx, op.target)}.`, op.target, networkOf(state, op.proposer));
  return null;
}

/** The proposer accepts what an invitee asked for. */
export function acceptCounter(ctx: SimContext, issuer: Id, opId: Id, invitee: Id): string | null {
  const op = ctx.state.operations.find((o) => o.id === opId);
  if (!op || op.status !== 'planning' || op.proposer !== issuer) return 'not your operation';
  const inv = op.invites.find((i) => i.to === invitee);
  if (!inv || inv.status !== 'countered' || !inv.counter) return 'there is no counter-offer to accept';
  if (inv.counter.plaza && op.invites.some((i) => i !== inv && i.status === 'accepted' && i.counter?.plaza)) return 'the plaza is already promised to someone else';
  const crews = inv.crews.filter((id) => ctx.state.crews[id]?.owner === invitee && !onOperation(ctx.state, id));
  return commit(ctx, op, inv, crews);
}

/** The proposer calls the whole thing off (free before anyone has fought). */
export function cancelOperation(ctx: SimContext, issuer: Id, opId: Id): string | null {
  const { state } = ctx;
  const op = state.operations.find((o) => o.id === opId);
  if (!op || op.status !== 'planning' || op.proposer !== issuer) return 'not your operation';
  op.status = 'cancelled';
  for (const c of committedCrews(state, op)) if (c.battle === null && (c.order.type === 'raid' || c.order.type === 'move')) c.order = c.location.kind === 'node' ? { type: 'garrison' } : { type: 'idle' };
  for (const inv of op.invites) if (inv.to === state.playerId && inv.status === 'accepted') pushFeed(state, 'important', `${charName(ctx, issuer)} called off the operation on ${placeName(ctx, op.target)}.`, op.target, networkOf(state, inv.to));
  return null;
}

/** An invitee backs out before the strike: free, like refusing. */
export function withdrawFromOperation(ctx: SimContext, issuer: Id, opId: Id): string | null {
  const { state } = ctx;
  const op = state.operations.find((o) => o.id === opId);
  const inv = op?.invites.find((i) => i.to === issuer);
  if (!op || op.status !== 'planning' || !inv || (inv.status !== 'accepted' && inv.status !== 'pending' && inv.status !== 'countered')) return 'you are not in that operation';
  if (state.hour >= op.strikeAt) return 'too late to back out: the operation is under way';
  for (const id of inv.crews) {
    const c = state.crews[id];
    if (c && c.battle === null && (c.order.type === 'raid' || c.order.type === 'move')) c.order = c.location.kind === 'node' ? { type: 'garrison' } : { type: 'idle' };
  }
  inv.status = 'withdrawn';
  if (op.proposer === state.playerId) pushFeed(state, 'important', `${charName(ctx, issuer)} pulled out of the operation on ${placeName(ctx, op.target)}.`, op.target, networkOf(state, op.proposer));
  return null;
}

// ---------------------------------------------------------------------------
// Hourly and daily
// ---------------------------------------------------------------------------

/** Hourly: expire unanswered player invites, record who fights, and settle operations. */
export function updateOperations(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.coalition;
  for (const op of state.operations) {
    if (op.status !== 'planning') continue;
    for (const inv of op.invites) {
      const deadline = Math.min(op.createdAt + t.playerResponseHours, op.strikeAt);
      if ((inv.status === 'pending' || inv.status === 'countered') && state.hour >= deadline) {
        inv.status = 'declined';
        inv.reason ??= 'no answer in time';
      }
    }
    // Who fights at the target counts toward the operation.
    const net = networkOf(state, op.proposer);
    if (state.hour >= op.strikeAt - t.earlyHours) {
      for (const b of Object.values(state.battles)) {
        if (b.where.kind !== 'node' || b.where.node !== op.target || b.colonia) continue;
        if (b.endedAt !== null && b.endedAt < state.hour - 1) continue;
        for (const side of [b.attackers, b.defenders]) {
          if (side.network !== net) continue;
          for (const o of side.owners) if (!op.fought.includes(o)) op.fought.push(o);
        }
      }
    }
    const owner = state.nodes[op.target]?.owner;
    const ours = !!owner && networkOf(state, owner) === net;
    if (op.kind === 'attack') {
      if (ours && state.hour >= op.strikeAt - t.earlyHours) settle(ctx, op, 'taken');
      else if (state.hour >= op.strikeAt + t.resolveWindowHours) settle(ctx, op, 'failed');
    } else {
      if (!ours && state.hour >= op.strikeAt - t.earlyHours) settle(ctx, op, 'lost');
      else if (op.holdUntil !== null && state.hour >= op.holdUntil) settle(ctx, op, 'held');
    }
  }
  // Keep a short history for the Diplomacy screen.
  state.operations = state.operations.filter((o) => o.status === 'planning' || state.hour - Math.max(o.strikeAt, o.holdUntil ?? 0) < 24 * 7);
}

/** Someone counts as having shown up if they fought there, or their crews are at the target. */
function showedUp(state: GameState, op: JointOp, who: Id, crews: Id[]): boolean {
  if (op.fought.includes(who)) return true;
  return crews.some((id) => {
    const c = state.crews[id];
    return !!c && c.location.kind === 'node' && c.location.node === op.target;
  });
}

function settle(ctx: SimContext, op: JointOp, result: NonNullable<JointOp['result']>): void {
  const { state, content } = ctx;
  const t = content.tuning.coalition;
  op.status = 'done';
  op.result = result;
  const accepted = op.invites.filter((i) => i.status === 'accepted');
  const proposerCame = showedUp(state, op, op.proposer, op.crews);
  for (const inv of accepted) {
    const came = showedUp(state, op, inv.to, inv.crews);
    if (!came) addOpinion(state, content, op.proposer, inv.to, 'did_not_show', t.noShowOpinion, t.noShowDecayDays);
    if (came && !proposerCame) addOpinion(state, content, inv.to, op.proposer, 'did_not_show', t.noShowOpinion, t.noShowDecayDays);
  }
  // Income shares promised to partners, paid by whoever now holds the plaza.
  if (result === 'taken') {
    const holder = state.nodes[op.target]?.owner;
    for (const inv of accepted) {
      if (!holder || inv.to === holder || inv.incomeShare <= 0 || inv.incomeWeeks <= 0) continue;
      state.pacts.push({
        id: newId(state, 'pact'),
        type: 'income_share',
        parties: [holder, inv.to],
        secret: false,
        expiresAt: state.hour + inv.incomeWeeks * 7 * 24,
        region: null,
        node: op.target,
        share: inv.incomeShare,
        createdAt: state.hour,
      });
    }
  }
  const name = placeName(ctx, op.target);
  const text = { taken: `The joint attack took ${name}.`, failed: `The joint attack on ${name} failed.`, held: `${name} held.`, lost: `${name} fell despite the joint defense.` }[result];
  for (const who of participants(op)) if (who === state.playerId) pushFeed(state, result === 'taken' || result === 'held' ? 'important' : 'routine', text, op.target, networkOf(state, who));
  for (const c of committedCrews(state, op)) if (c.battle === null && c.order.type === 'raid' && c.order.target === op.target) c.order = { type: 'idle' };
}

/** Daily: plans may leak to the defenders. */
export function runOperationsDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const l = content.tuning.coalition.leak;
  for (const op of state.operations) {
    if (op.status !== 'planning' || op.kind !== 'attack' || op.leaked || state.hour >= op.strikeAt) continue;
    const who = participants(op);
    if (who.length < 2) continue;
    const astucia = who.reduce((n, id) => n + (state.characters[id]?.skills.astucia ?? 0), 0) / who.length;
    const p = Math.max(0, Math.min(1, l.base + l.perParticipant * who.length - l.perAstucia * astucia));
    if (!chance(state.rng, p)) continue;
    op.leaked = true;
    const owner = state.nodes[op.target]?.owner;
    if (!owner) continue;
    const defenders = networkOf(state, owner);
    for (const c of committedCrews(state, op)) report(ctx, defenders, groupOf(state, c), 'rumor', 'estimated', null);
    pushFeed(state, 'critical', `Word is out: ${charName(ctx, op.proposer)} and others are gathering to hit ${placeName(ctx, op.target)} around day ${Math.floor(op.strikeAt / 24)}.`, op.target, defenders);
    tellSide(state, op.proposer, 'important', `Your plan to hit ${placeName(ctx, op.target)} has leaked.`, (n) => `${n}'s plan to hit ${placeName(ctx, op.target)} has leaked.`, op.target);
  }
}
