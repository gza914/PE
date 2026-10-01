/**
 * Pacts between characters (GDD "Pacts and the Diplomacy screen"). Every pact
 * is proposed through one offer menu and answered yes or no. Breaking one is
 * always possible, never free, and always visible to the person you broke it
 * with.
 *
 *   non_aggression  neither attacks the other (secret across faction lines)
 *   safe_passage    each other's crews pass without interception
 *   mutual_defense  when either is attacked, the other is called (same side)
 *   route_share     the proposer pays a share of a route's income
 *   local_truce     no fighting in one region for a while; binds whole sides
 *                   when a faction head is a party, else just the two bosses
 *   income_share    a partner's cut of a plaza taken in a joint operation
 */
import type { Content } from '../data/content';
import { newId, pushFeed, tellSide, type SimContext } from './context';
import { cashOf, deposit, spend, spendUpTo } from './money';
import { networkOf } from './network';
import { addOpinion } from './opinion';
import { charName } from './orders';
import { chance } from './rng';
import type { Battle, GameState, Id, NetworkId, Pact, PactType } from './state';
import { world } from './world';

function alive(state: GameState, p: Pact): boolean {
  return p.expiresAt === null || p.expiresAt > state.hour;
}

function isHead(state: GameState, id: Id): boolean {
  const f = state.characters[id]?.faction;
  return !!f && state.factions[f]?.head === id;
}

/** A truce made by a faction head binds his whole side; one between two bosses binds only them. */
function sideWide(state: GameState, p: Pact): boolean {
  return isHead(state, p.parties[0]) || isHead(state, p.parties[1]);
}

/** Is there a side-wide local truce between these two networks in this region right now? */
export function truceBetween(state: GameState, a: NetworkId, b: NetworkId, region: Id): boolean {
  if (a === b) return false;
  return state.pacts.some((p) => {
    if (p.type !== 'local_truce' || !alive(state, p) || p.region !== region || !sideWide(state, p)) return false;
    const x = networkOf(state, p.parties[0]);
    const y = networkOf(state, p.parties[1]);
    return (x === a && y === b) || (x === b && y === a);
  });
}

/** The live pact of a type between two characters, if any. */
export function pactBetween(state: GameState, a: Id, b: Id, type: PactType): Pact | undefined {
  return state.pacts.find((p) => p.type === type && alive(state, p) && ((p.parties[0] === a && p.parties[1] === b) || (p.parties[0] === b && p.parties[1] === a)));
}

/**
 * Do pacts between any attacker and any defender owner forbid this fight?
 * Non-aggression always does; safe passage does unless it is an attack on a
 * plaza; a truce between two bosses does inside its region.
 */
export function peaceBetween(state: GameState, attackers: Id[], defenders: Id[], region: Id, capture: boolean): boolean {
  for (const a of attackers) {
    for (const d of defenders) {
      if (a === d) continue;
      if (pactBetween(state, a, d, 'non_aggression')) return true;
      if (!capture && pactBetween(state, a, d, 'safe_passage')) return true;
      const t = pactBetween(state, a, d, 'local_truce');
      if (t && t.region === region) return true;
    }
  }
  return false;
}

export function addTruce(state: GameState, a: Id, b: Id, region: Id, hours: number): void {
  const parties: [Id, Id] = a < b ? [a, b] : [b, a];
  const existing = state.pacts.find((p) => p.type === 'local_truce' && alive(state, p) && p.region === region && p.parties[0] === parties[0] && p.parties[1] === parties[1]);
  if (existing) {
    existing.expiresAt = Math.max(existing.expiresAt ?? 0, state.hour + hours);
    return;
  }
  state.pacts.push({ id: newId(state, 'pact'), type: 'local_truce', parties, secret: false, expiresAt: state.hour + hours, region, createdAt: state.hour });
}

/** Ends every truce the character's network holds in a region. Returns how many were broken. */
export function breakTruces(state: GameState, who: Id, region: Id): number {
  const net = networkOf(state, who);
  let n = 0;
  for (const p of state.pacts) {
    if (p.type !== 'local_truce' || !alive(state, p) || p.region !== region) continue;
    if (networkOf(state, p.parties[0]) === net || networkOf(state, p.parties[1]) === net) {
      p.expiresAt = state.hour;
      n++;
    }
  }
  return n;
}

/** Drops expired pacts and offers. */
export function prunePacts(state: GameState): void {
  state.pacts = state.pacts.filter((p) => alive(state, p));
  state.pactOffers = state.pactOffers.filter((o) => o.respondBy > state.hour);
}

// ---------------------------------------------------------------------------
// Proposing, answering, breaking
// ---------------------------------------------------------------------------

export interface PactSpec {
  to: Id;
  pact: Exclude<PactType, 'income_share'>;
  region?: Id | null;
  route?: Id | null;
  share?: number;
  cash?: number;
  days?: number;
}

export const PACT_LABEL: Record<PactType, string> = {
  non_aggression: 'Non-aggression',
  safe_passage: 'Safe passage',
  mutual_defense: 'Mutual defense',
  route_share: 'Route share',
  local_truce: 'Local truce',
  income_share: 'Income share',
};

/** Why this pact cannot be offered, or null. */
export function pactBlocked(state: GameState, content: Content, from: Id, spec: PactSpec): string | null {
  const a = state.characters[from];
  const b = state.characters[spec.to];
  if (!a || !b || from === spec.to) return 'pick someone else';
  if (b.status !== 'free') return `${b.alias ?? b.name} is ${b.status}`;
  const sameSide = a.faction !== null && a.faction === b.faction;
  if (pactBetween(state, from, spec.to, spec.pact)) return 'you already have that pact';
  if (state.pactOffers.some((o) => o.from === from && o.to === spec.to && o.type === spec.pact)) return 'that offer is already on the table';
  if ((spec.cash ?? 0) < 0 || (spec.cash ?? 0) > cashOf(state, from)) return 'you cannot offer cash you do not have';
  switch (spec.pact) {
    case 'mutual_defense':
      return sameSide ? null : 'mutual defense is for bosses on your own side';
    case 'non_aggression':
    case 'safe_passage':
      return sameSide ? 'your own side already does not fight you' : null;
    case 'local_truce':
      if (sameSide) return 'there is no fighting to stop with your own side';
      return spec.region && state.regions[spec.region] ? null : 'pick a region';
    case 'route_share': {
      const route = content.routes.find((r) => r.id === spec.route);
      if (!route) return 'pick a route';
      if (!route.nodes.some((n) => state.nodes[n]?.owner === from)) return 'you hold nothing on that route to share';
      const share = spec.share ?? 0;
      if (!(share > 0) || share > content.tuning.coalition.pacts.maxRouteShare) return `offer a share up to ${Math.round(content.tuning.coalition.pacts.maxRouteShare * 100)}%`;
      return null;
    }
  }
}

export function proposePact(ctx: SimContext, from: Id, spec: PactSpec): string | null {
  const { state, content } = ctx;
  const blocked = pactBlocked(state, content, from, spec);
  if (blocked) return blocked;
  const t = content.tuning.coalition.pacts;
  state.pactOffers.push({
    id: newId(state, 'offer'),
    type: spec.pact,
    from,
    to: spec.to,
    region: spec.region ?? null,
    route: spec.route ?? null,
    share: spec.share ?? 0,
    cash: Math.floor(spec.cash ?? 0),
    days: Math.max(0, Math.floor(spec.days ?? t.defaultDays)),
    createdAt: state.hour,
    respondBy: state.hour + t.offerHours,
  });
  if (spec.to === state.playerId) pushFeed(state, 'important', `${charName(ctx, from)} offers you a pact: ${PACT_LABEL[spec.pact].toLowerCase()}. Answer in the Diplomacy tab.`, null, networkOf(state, spec.to));
  return null;
}

export function respondPact(ctx: SimContext, issuer: Id, offerId: Id, accept: boolean): string | null {
  const { state, content } = ctx;
  const offer = state.pactOffers.find((o) => o.id === offerId);
  if (!offer) return 'that offer has expired';
  if (offer.to !== issuer) return 'that offer is not for you';
  state.pactOffers = state.pactOffers.filter((o) => o !== offer);
  const label = PACT_LABEL[offer.type].toLowerCase();
  if (!accept) {
    if (offer.from === state.playerId) pushFeed(state, 'routine', `${charName(ctx, issuer)} turned down your ${label} offer.`, null, networkOf(state, offer.from));
    return null;
  }
  if (offer.cash > 0 && !spend(state, content, offer.from, offer.cash, 'deals')) return `${charName(ctx, offer.from)} can no longer pay`;
  if (offer.cash > 0) deposit(state, content, issuer, offer.cash, 'deals');
  const a = state.characters[offer.from]!;
  const b = state.characters[issuer]!;
  const secret = offer.type === 'non_aggression' && a.faction !== b.faction && (a.faction !== null || b.faction !== null);
  const expiresAt = offer.days > 0 ? state.hour + offer.days * 24 : null;
  if (offer.type === 'local_truce') addTruce(state, offer.from, issuer, offer.region!, (offer.days || content.tuning.coalition.pacts.defaultDays) * 24);
  else {
    state.pacts.push({
      id: newId(state, 'pact'),
      type: offer.type,
      parties: [offer.from, issuer],
      secret,
      expiresAt,
      region: offer.region,
      route: offer.route,
      share: offer.share,
      createdAt: state.hour,
      calls: [],
    });
  }
  if (offer.from === state.playerId || issuer === state.playerId) {
    const other = offer.from === state.playerId ? issuer : offer.from;
    pushFeed(state, 'important', `You and ${charName(ctx, other)} have a pact: ${label}.`, null, networkOf(state, state.playerId));
  }
  return null;
}

/** Ends a pact. Always possible, never free. */
export function breakPact(ctx: SimContext, issuer: Id, pactId: Id): string | null {
  const { state, content } = ctx;
  const p = state.pacts.find((x) => x.id === pactId && alive(state, x));
  if (!p || !p.parties.includes(issuer)) return 'you have no such pact';
  const other = p.parties[0] === issuer ? p.parties[1] : p.parties[0];
  const t = content.tuning.coalition.pacts;
  p.expiresAt = state.hour;
  addOpinion(state, content, other, issuer, 'broke_our_pact', t.breakOpinion[p.type], content.tuning.events.opinionDecayDays);
  if (p.type === 'local_truce') {
    const ch = state.characters[issuer]!;
    ch.credibility = Math.max(0, ch.credibility - t.truceBreakCredibility);
  }
  pushFeed(state, 'important', `${charName(ctx, issuer)} broke the ${PACT_LABEL[p.type].toLowerCase()} pact with ${charName(ctx, other)}.`, null, networkOf(state, other));
  if (issuer === state.playerId) pushFeed(state, 'important', `You broke your ${PACT_LABEL[p.type].toLowerCase()} pact with ${charName(ctx, other)}.`, null, networkOf(state, issuer));
  return null;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Daily: secret pacts across faction lines may come out. */
export function runPactsDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.coalition.pacts;
  for (const p of state.pacts) {
    if (!p.secret || !alive(state, p) || !chance(state.rng, t.secretDiscoveryPerDay)) continue;
    p.secret = false;
    for (const who of p.parties) {
      const f = state.characters[who]?.faction;
      const head = f ? state.factions[f]?.head : null;
      if (head && head !== who) addOpinion(state, content, head, who, 'secret_dealings', t.secretDiscoveredOpinion, content.tuning.events.opinionDecayDays);
    }
    pushFeed(state, 'important', `Word is out that ${charName(ctx, p.parties[0])} and ${charName(ctx, p.parties[1])} have a secret non-aggression pact.`, null, null);
  }
}

/** Route and income shares, paid out of the day's income lines. */
export function payShares(ctx: SimContext, lines: { recipient: Id; amount: number; source: Id; node: Id | null }[]): void {
  const { state, content } = ctx;
  for (const p of state.pacts) {
    if (!alive(state, p) || (p.type !== 'route_share' && p.type !== 'income_share')) continue;
    const [payer, payee] = p.parties;
    if (p.type === 'income_share' && state.nodes[p.node ?? '']?.owner !== payer) {
      p.expiresAt = state.hour; // the plaza changed hands: the deal is over
      continue;
    }
    const income = lines
      .filter((l) => l.recipient === payer && (p.type === 'route_share' ? l.source === p.route : l.node === p.node || l.source === p.node))
      .reduce((n, l) => n + l.amount, 0);
    const paid = spendUpTo(state, content, payer, income * (p.share ?? 0), 'deals');
    deposit(state, content, payee, paid, 'deals');
  }
}

/**
 * A battle at a plaza: each mutual defense partner of the plaza's owner is
 * called. AI partners send their nearest crew (the caller hands back the
 * crews to send); the player is told. Records whether they could have come.
 */
export function mutualDefenseCalls(ctx: SimContext, b: Battle, couldCome: (partner: Id) => boolean): Id[] {
  const { state } = ctx;
  if (b.where.kind !== 'node') return [];
  const owner = state.nodes[b.where.node]?.owner;
  if (!owner || !b.defenders.owners.includes(owner)) return [];
  const partners: Id[] = [];
  for (const p of state.pacts) {
    if (p.type !== 'mutual_defense' || !alive(state, p) || !p.parties.includes(owner)) continue;
    const partner = p.parties[0] === owner ? p.parties[1] : p.parties[0];
    if (state.characters[partner]?.status !== 'free') continue;
    const could = couldCome(partner);
    (p.calls ??= []).push({ battle: b.id, at: state.hour, caller: owner, answered: !could });
    partners.push(partner);
    if (partner === state.playerId) {
      pushFeed(state, 'critical', `${charName(ctx, owner)} calls on your mutual defense pact: ${world(ctx.content).node(b.where.node).name} is under attack. Send crews from the battle panel.`, b.where.node, networkOf(state, partner), b.id);
    }
  }
  return partners;
}

/** When a battle ends: a partner who could have come and did not is remembered. */
export function settleDefenseCalls(ctx: SimContext, b: Battle): void {
  const { state, content } = ctx;
  for (const p of state.pacts) {
    for (const call of p.calls ?? []) {
      if (call.battle !== b.id || call.answered) continue;
      call.answered = true;
      const partner = p.parties[0] === call.caller ? p.parties[1] : p.parties[0];
      if (b.defenders.owners.includes(partner)) continue;
      addOpinion(state, content, call.caller, partner, 'ignored_our_pact', content.tuning.coalition.pacts.ignoredCallOpinion, content.tuning.events.opinionDecayDays);
      tellSide(state, partner, 'important', `You did not answer ${charName(ctx, call.caller)}'s call for help.`, (n) => `${n} did not answer ${charName(ctx, call.caller)}'s call for help.`);
    }
  }
}
