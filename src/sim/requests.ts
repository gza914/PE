/**
 * Faction requests: duties a faction head sends to their people (GDD "Faction
 * requests"). AI lieutenants and the player answer through the same
 * `respond_request` command. Accepting and delivering builds the head's
 * opinion of you; refusing, ignoring, or failing costs it.
 */
import { newId, pushFeed, type SimContext } from './context';
import { deposit, spend } from './money';
import { networkOf } from './network';
import { addOpinion } from './opinion';
import { charName } from './orders';
import { onOperation } from './operations';
import type { FactionRequest, GameState, Id, RequestKind } from './state';
import { world } from './world';

export interface RequestSpec {
  faction: Id;
  from: Id;
  to: Id;
  kind: RequestKind;
  target?: Id | null;
  crews?: Id[];
  amount?: number;
  arriveBy?: number | null;
  offensive?: Id | null;
}

export function describeRequest(ctx: SimContext, r: FactionRequest): string {
  const w = world(ctx.content);
  const place = (id: Id | null) =>
    id === null ? '' : (ctx.content.culiacan.colonias.find((c) => c.id === id)?.name ?? (ctx.content.nodes.some((n) => n.id === id) ? w.node(id).name : id));
  const men = r.crews.reduce((n, id) => n + (ctx.state.crews[id]?.men ?? 0), 0);
  switch (r.kind) {
    case 'join_offensive':
      return `join the attack on ${place(r.target)}${men ? ` with ${men} men` : ''}`;
    case 'defend':
      return `send men to defend ${place(r.target)}`;
    case 'levy':
      return `pay a levy of $${Math.round(r.amount).toLocaleString()}`;
    case 'hold_colonia':
      return `commit a crew to ${place(r.target)} in Culiacán`;
  }
}

export function createRequest(ctx: SimContext, spec: RequestSpec): FactionRequest {
  const { state, content } = ctx;
  const t = content.tuning.ai;
  const toPlayer = spec.to === state.playerId;
  const r: FactionRequest = {
    id: newId(state, 'req'),
    faction: spec.faction,
    from: spec.from,
    to: spec.to,
    kind: spec.kind,
    target: spec.target ?? null,
    crews: spec.crews ?? [],
    amount: spec.amount ?? 0,
    arriveBy: spec.arriveBy ?? null,
    offensive: spec.offensive ?? null,
    createdAt: state.hour,
    respondBy: state.hour + (toPlayer ? t.requests.playerResponseHours : t.strategic.responseHours),
    status: 'pending',
    resolvedAt: null,
  };
  state.requests.push(r);
  if (toPlayer) {
    pushFeed(state, 'critical', `${charName(ctx, spec.from)} asks you to ${describeRequest(ctx, r)}. Answer in the Faction tab.`, r.target, networkOf(state, spec.to));
  }
  return r;
}

function headOpinion(ctx: SimContext, r: FactionRequest, key: string, value: number): void {
  addOpinion(ctx.state, ctx.content, r.from, r.to, key, value, ctx.content.tuning.ai.requests.opinionDecayDays);
}

function resolve(ctx: SimContext, r: FactionRequest, status: FactionRequest['status']): void {
  r.status = status;
  r.resolvedAt = ctx.state.hour;
  const t = ctx.content.tuning.ai.requests;
  if (status === 'fulfilled') headOpinion(ctx, r, 'kept_their_word', t.fulfilledOpinion);
  if (status === 'failed') headOpinion(ctx, r, 'failed_a_request', t.failedOpinion);
  if (status === 'declined') headOpinion(ctx, r, 'refused_a_request', t.declinedOpinion);
  if (status === 'expired') headOpinion(ctx, r, 'ignored_a_request', t.ignoredOpinion);
  if (r.to === ctx.state.playerId && status !== 'accepted') {
    const text = { fulfilled: 'is pleased: you kept your word', failed: 'noticed you did not deliver', declined: 'noted your refusal', expired: 'noticed you ignored the request', cancelled: 'called off the request', pending: '', accepted: '' }[status];
    if (text) pushFeed(ctx.state, status === 'fulfilled' || status === 'cancelled' ? 'routine' : 'important', `${charName(ctx, r.from)} ${text}.`, null, networkOf(ctx.state, r.to));
  }
}

/**
 * Answer a request. Levies are paid on the spot, and are a negotiation: a
 * member may pay part (`amount`), for proportionate credit with the head.
 */
export function respondToRequest(ctx: SimContext, issuer: Id, id: Id, accept: boolean, amount?: number): string | null {
  const { state, content } = ctx;
  const r = state.requests.find((x) => x.id === id);
  if (!r) return 'no such request';
  if (r.to !== issuer) return 'that request is not for you';
  if (r.status !== 'pending') return `that request is already ${r.status}`;
  if (!accept) {
    resolve(ctx, r, 'declined');
    return null;
  }
  if (r.kind === 'levy') {
    const pay = amount === undefined ? r.amount : Math.floor(amount);
    if (!(pay > 0) || pay > r.amount) return `pay between $1 and $${Math.round(r.amount).toLocaleString()}`;
    if (!spend(state, content, issuer, pay, 'tribute')) return `you do not have $${Math.round(pay).toLocaleString()}`;
    deposit(state, content, r.from, pay, 'tribute');
    if (pay < r.amount) {
      r.status = 'fulfilled';
      r.resolvedAt = state.hour;
      headOpinion(ctx, r, 'paid_part_of_a_levy', content.tuning.ai.requests.fulfilledOpinion * (pay / r.amount));
      r.amount = pay;
      return null;
    }
    resolve(ctx, r, 'fulfilled');
    return null;
  }
  r.status = 'accepted';
  return null;
}

/** Settles a finished offensive's requests: delivered if any requested crew fought there. */
export function settleOffensiveRequests(ctx: SimContext, offensive: Id, fought: ReadonlySet<Id>, won: boolean): void {
  for (const r of ctx.state.requests) {
    if (r.offensive !== offensive) continue;
    if (r.status === 'pending') resolve(ctx, r, 'cancelled');
    else if (r.status === 'accepted') {
      const delivered = fought.has(r.to);
      resolve(ctx, r, delivered ? 'fulfilled' : 'failed');
      if (delivered && won) addOpinion(ctx.state, ctx.content, r.to, r.from, 'shared_a_victory', ctx.content.tuning.ai.requests.rewardOpinion, ctx.content.tuning.ai.requests.opinionDecayDays);
    }
  }
}

export function cancelOffensiveRequests(ctx: SimContext, offensive: Id): void {
  for (const r of ctx.state.requests) if (r.offensive === offensive && (r.status === 'pending' || r.status === 'accepted')) resolve(ctx, r, 'cancelled');
}

/** Hourly: expire unanswered requests, judge defend and colonia requests at their deadline, prune old ones. */
export function updateRequests(ctx: SimContext): void {
  const { state, content } = ctx;
  const grace = content.tuning.ai.strategic.slackHours;
  for (const r of state.requests) {
    if (r.status === 'pending' && state.hour > r.respondBy) resolve(ctx, r, 'expired');
    if (r.status !== 'accepted' || r.offensive !== null || r.arriveBy === null || state.hour < r.arriveBy + grace) continue;
    const crews = Object.values(state.crews).filter((c) => c.owner === r.to);
    const ok =
      r.kind === 'hold_colonia'
        ? crews.some((c) => c.colonia === r.target)
        : crews.some((c) => c.location.kind === 'node' && c.location.node === r.target);
    resolve(ctx, r, ok ? 'fulfilled' : 'failed');
  }
  const keep = content.tuning.ai.requests.keepHours;
  state.requests = state.requests.filter((r) => r.resolvedAt === null || state.hour - r.resolvedAt <= keep);
}

export function pendingRequestsFor(state: { requests: FactionRequest[] }, id: Id): FactionRequest[] {
  return state.requests.filter((r) => r.to === id && r.status === 'pending');
}

/** Crews tied to an accepted request that has not been judged yet: they stay on the job. */
export function onDuty(state: GameState, crew: Id): boolean {
  return state.requests.some((r) => r.status === 'accepted' && r.crews.includes(crew)) || onOperation(state, crew);
}

/** May `from` ask `to` for something right now? Not while a request is open, nor soon after a refusal. */
export function mayAsk(state: { requests: FactionRequest[]; hour: number }, from: Id, to: Id, cooldownHours: number): boolean {
  return !state.requests.some(
    (r) =>
      r.from === from &&
      r.to === to &&
      (r.status === 'pending' || r.status === 'accepted' || ((r.status === 'declined' || r.status === 'expired') && state.hour - (r.resolvedAt ?? r.createdAt) < cooldownHours)),
  );
}
