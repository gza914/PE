/**
 * Outside cartels: CJNG and CdG (GDD "Outside cartels: CJNG and CdG").
 *
 * Only faction heads and the player deal with them, through a negotiation of
 * up to `maxRounds` offers: you ask for men, weapons, armored trucks, or a
 * loan; you offer cash, a weekly retainer, a share of income, a plaza now, or
 * a plaza later. They counter by coming part of the way down.
 *
 * Their men stay theirs: contingents are crews you command (`hired.kind ===
 * 'contingent'`) with a loyalty meter; their boss can recall them; a loyal
 * contingent may offer to stay as your men. A plaza given to them makes them
 * an associate of your coalition: their boss joins your faction as an
 * outsider (`CharacterState.outsider`), holds it with his own crew, and counts
 * toward your side's share, until his ambition peaks and he declares for
 * himself.
 */
import type { Content } from '../data/content';
import { newId, pushFeed, type SimContext } from './context';
import { orderCrew } from './commands';
import { weaponsCost } from './forces';
import { cashOf, deposit, ledgerTotals, spend, spendUpTo } from './money';
import { networkOf } from './network';
import { newTransit } from './newGame';
import { charName } from './orders';
import { chance, rand } from './rng';
import type { CrewState, GameState, Id, OutsideAsk, OutsideDeal, OutsideOffer, OutsiderState, OutsideTier } from './state';
import { nodeValue, territoryShares } from './systems/economy';
import { world } from './world';

export const OUTSIDE_TIERS: OutsideTier[] = ['carne', 'sicarios', 'elite'];
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export const NO_OFFER: OutsideOffer = { cash: 0, retainer: 0, retainerWeeks: 0, incomeShare: 0, incomeWeeks: 0, plazaNow: null, plazaLater: null };

export function cartelName(content: Content, cartel: Id): string {
  return content.factions.find((f) => f.id === cartel)?.name ?? cartel;
}

export function cartelHead(content: Content, cartel: Id): Id {
  return content.factions.find((f) => f.id === cartel)!.head!;
}

function cfg(content: Content, cartel: Id) {
  return content.tuning.outside.cartels[cartel]!;
}

export function outsideCartels(content: Content): Id[] {
  return content.factions.filter((f) => f.kind === 'outside').map((f) => f.id);
}

/** The faction an outside cartel stands with, if any (it never stands with itself once it declares). */
export function associateOf(state: GameState, cartel: Id): Id | null {
  const head = state.characters[state.factions[cartel]?.head ?? ''];
  if (!head || state.outsiders[cartel]?.declared) return null;
  return head.faction !== null && head.faction !== cartel ? head.faction : null;
}

/** Who may deal with outside cartels: the player, and faction heads. */
export function dealerBlocked(state: GameState, id: Id): string | null {
  const ch = state.characters[id];
  if (!ch || ch.status !== 'free') return 'only a free boss can deal';
  if (ch.outsider !== null) return 'they do not hire each other';
  if (id === state.playerId) return null;
  if (ch.faction !== null && state.factions[ch.faction]?.head === id) return null;
  return 'only faction heads and you deal with outside cartels';
}

/** How a boss can reach a cartel, or null if he cannot. */
export function contactVia(state: GameState, content: Content, client: Id, cartel: Id): string | null {
  const o = state.outsiders[cartel];
  if (!o) return null;
  if ((o.envoys[client] ?? -1) > state.hour) return 'their envoy';
  const w = world(content);
  const t = content.tuning.outside;
  for (const n of Object.keys(state.nodes).sort()) {
    if (state.nodes[n]!.owner !== client) continue;
    const def = w.node(n);
    if (t.contactNodeTypes.includes(def.type)) return `your port at ${def.name}`;
    if (w.neighbors(n).some((nb) => w.node(nb.other).type === 'border_exit')) return `the border road from ${def.name}`;
  }
  return null;
}

function weeklyIncome(state: GameState, id: Id): number {
  const ch = state.characters[id];
  const days = Math.min(7, ch?.ledger.length ?? 0);
  return days > 0 ? (ledgerTotals(state, id, days).income * 7) / days : 0;
}

/** What the ask costs before haggling: up front, and weekly for men. */
export function askPrice(state: GameState, content: Content, cartel: Id, client: Id, ask: OutsideAsk): { upfront: number; weekly: number } {
  const c = cfg(content, cartel);
  const t = content.tuning.outside;
  const ch = state.characters[client];
  const attitude = state.outsiders[cartel]?.attitude[client] ?? 0;
  const mult = Math.max(0.5, Math.min(1.5, 1 - attitude * t.attitudePriceEffect)) * (ch?.faction === null ? t.neutralDiscount : 1);
  switch (ask.kind) {
    case 'men': {
      const tier = c.tiers[ask.tier]!;
      return { upfront: tier.pricePerMan * ask.men * mult, weekly: tier.weeklyPerMan * ask.men };
    }
    case 'weapons': {
      const crew = state.crews[ask.crew];
      return { upfront: crew ? weaponsCost(content.tuning, crew, ask.gear) * c.weaponsCostMultiplier * mult : 0, weekly: 0 };
    }
    case 'armored':
      return { upfront: ask.count * c.armoredCost * mult, weekly: 0 };
    case 'loan':
      return { upfront: 0, weekly: 0 };
  }
}

/** What an offer is worth to them. */
export function offerValue(state: GameState, content: Content, cartel: Id, client: Id, offer: OutsideOffer): number {
  const c = cfg(content, cartel);
  const t = content.tuning.outside;
  let v = offer.cash * c.cashValueMultiplier;
  v += offer.retainer * Math.min(offer.retainerWeeks, t.retainerWeeksValued);
  v += offer.incomeShare * weeklyIncome(state, client) * Math.min(offer.incomeWeeks, t.incomeShareWeeksValued) * c.routeValueMultiplier;
  if (offer.plazaNow) v += nodeValue(state, content, offer.plazaNow) * t.plazaDaysValued * c.plazaValueMultiplier;
  if (offer.plazaLater) v += nodeValue(state, content, offer.plazaLater) * t.plazaDaysValued * c.plazaValueMultiplier * t.plazaLaterDiscount;
  return v;
}

function askBlocked(state: GameState, content: Content, cartel: Id, client: Id, ask: OutsideAsk): string | null {
  const c = cfg(content, cartel);
  switch (ask.kind) {
    case 'men': {
      const tier = c.tiers[ask.tier];
      if (!tier) return 'unknown tier';
      if (!Number.isInteger(ask.men) || ask.men < content.tuning.crews.minMen || ask.men > Math.min(tier.maxMen, content.tuning.crews.maxMen)) return `they offer ${content.tuning.crews.minMen}–${Math.min(tier.maxMen, content.tuning.crews.maxMen)} men at that level`;
      if (state.nodes[ask.node]?.owner !== client) return 'their men report to a plaza you hold';
      return null;
    }
    case 'weapons': {
      const crew = state.crews[ask.crew];
      if (!crew || crew.owner !== client) return 'pick one of your crews';
      if (!Number.isInteger(ask.gear) || ask.gear <= crew.gear || ask.gear > 5) return 'pick better weapons than they carry';
      return null;
    }
    case 'armored': {
      const crew = state.crews[ask.crew];
      if (!crew || crew.owner !== client) return 'pick one of your crews';
      if (!Number.isInteger(ask.count) || ask.count < 1 || ask.count > c.armoredMax) return `they can bring 1–${c.armoredMax} armored trucks`;
      return null;
    }
    case 'loan': {
      if (!(ask.amount > 0) || ask.amount > c.loanMax) return `they lend up to ${money(c.loanMax)}`;
      if (state.outsiders[cartel]!.loans.some((l) => l.by === client)) return 'pay back what you owe first';
      return null;
    }
  }
}

function offerBlocked(state: GameState, content: Content, cartel: Id, client: Id, offer: OutsideOffer): string | null {
  const ch = state.characters[client]!;
  const nums = [offer.cash, offer.retainer, offer.retainerWeeks, offer.incomeShare, offer.incomeWeeks];
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return 'offer only positive amounts';
  if (offer.cash > cashOf(state, client)) return 'you cannot offer cash you do not have';
  if (offer.incomeShare > 0.5) return 'at most half your income';
  for (const n of [offer.plazaNow, offer.plazaLater]) {
    if (n === null) continue;
    if (state.nodes[n]?.owner !== client) return 'you can only offer plazas you hold';
    if (n === content.culiacan.parentNode) return 'Culiacán is not yours to give';
  }
  if (offer.plazaNow && offer.plazaNow === offer.plazaLater) return 'one plaza, once';
  const partner = associateOf(state, cartel);
  if ((offer.plazaNow || offer.plazaLater) && partner !== null && partner !== ch.faction) return `they already stand with the ${content.factions.find((f) => f.id === partner)?.name ?? partner}`;
  return null;
}

export interface DealSpec {
  cartel: Id;
  ask: OutsideAsk;
  offer: OutsideOffer;
  /** An open deal this offer continues (the next round). */
  deal?: Id | null;
}

/** Why `client` cannot open or continue this negotiation, or null. */
export function dealBlocked(state: GameState, content: Content, client: Id, spec: DealSpec): string | null {
  const o = state.outsiders[spec.cartel];
  if (!o) return 'unknown outside cartel';
  const blocked = dealerBlocked(state, client);
  if (blocked) return blocked;
  if (o.hostile.includes(client)) return `${cartelName(content, spec.cartel)} wants nothing to do with you`;
  if ((o.silentUntil[client] ?? -1) > state.hour) return `${cartelName(content, spec.cartel)} is not taking your calls for now`;
  if (!contactVia(state, content, client, spec.cartel)) return 'you have no way to reach them: hold a port or a border road, or wait for an envoy';
  if (spec.deal) {
    const d = state.outsideDeals.find((x) => x.id === spec.deal);
    if (!d || d.client !== client || d.status !== 'open') return 'no such open deal';
  } else if (state.outsideDeals.some((d) => d.client === client && d.cartel === spec.cartel && d.status === 'open')) return 'finish the deal on the table first';
  return askBlocked(state, content, spec.cartel, client, spec.ask) ?? offerBlocked(state, content, spec.cartel, client, spec.offer);
}

/** Make an offer (a new deal, or the next round of an open one). They agree, counter, or walk. */
export function proposeDeal(ctx: SimContext, client: Id, spec: DealSpec): string | null {
  const { state, content } = ctx;
  const blocked = dealBlocked(state, content, client, spec);
  if (blocked) return blocked;
  const t = content.tuning.outside;
  let deal = spec.deal ? state.outsideDeals.find((d) => d.id === spec.deal)! : null;
  if (!deal) {
    deal = { id: newId(state, 'odeal'), cartel: spec.cartel, client, ask: spec.ask, offer: spec.offer, counter: null, round: 0, status: 'open', createdAt: state.hour, reason: null, price: 0 };
    deal.price = priceOf(state, content, deal);
    state.outsideDeals.push(deal);
  } else {
    deal.ask = spec.ask;
    deal.offer = spec.offer;
    deal.price = Math.min(deal.price, priceOf(state, content, deal));
  }
  deal.round += 1;
  deal.counter = null;
  const value = offerValue(state, content, spec.cartel, client, spec.offer);
  if (value + 1e-6 >= deal.price) return execute(ctx, deal, spec.offer);
  if (deal.round >= t.maxRounds) {
    walk(ctx, deal, 'they lost interest');
    return null;
  }
  // They come part of the way down and name what would close it.
  deal.price = deal.price - t.counterMeetShare * (deal.price - value);
  deal.counter = counterOffer(state, content, deal, value);
  deal.reason = describeCounter(state, content, deal);
  if (client === state.playerId) pushFeed(state, 'important', `${cartelName(content, deal.cartel)} counters: ${deal.reason}. See Diplomacy.`, null, networkOf(state, client));
  return null;
}

function priceOf(state: GameState, content: Content, deal: OutsideDeal): number {
  return askPrice(state, content, deal.cartel, deal.client, deal.ask).upfront;
}

/** More cash if the client has it; else a plaza if they value plazas; else more cash anyway. */
function counterOffer(state: GameState, content: Content, deal: OutsideDeal, value: number): OutsideOffer {
  const c = cfg(content, deal.cartel);
  const gap = deal.price - value;
  const cash = Math.ceil(gap / c.cashValueMultiplier / 1000) * 1000;
  if (deal.offer.cash + cash <= cashOf(state, deal.client) || c.plazaValueMultiplier <= c.cashValueMultiplier) return { ...deal.offer, cash: deal.offer.cash + cash };
  const t = content.tuning.outside;
  const plaza = Object.keys(state.nodes)
    .sort()
    .filter((n) => state.nodes[n]!.owner === deal.client && n !== content.culiacan.parentNode && n !== deal.offer.plazaNow && n !== deal.offer.plazaLater)
    .map((n) => ({ n, v: nodeValue(state, content, n) * t.plazaDaysValued * c.plazaValueMultiplier }))
    .filter((x) => x.v >= gap)
    .sort((a, b) => a.v - b.v || (a.n < b.n ? -1 : 1))[0];
  if (plaza && associateOf(state, deal.cartel) === null && !deal.offer.plazaNow) return { ...deal.offer, plazaNow: plaza.n };
  return { ...deal.offer, cash: deal.offer.cash + cash };
}

function describeCounter(state: GameState, content: Content, deal: OutsideDeal): string {
  const c = deal.counter!;
  const parts: string[] = [];
  if (c.cash > deal.offer.cash) parts.push(`${money(c.cash)} up front`);
  if (c.plazaNow && c.plazaNow !== deal.offer.plazaNow) parts.push(`${world(content).node(c.plazaNow).name}, now`);
  return parts.length ? `they want ${parts.join(' and ')}` : 'they want more';
}

export function acceptCounter(ctx: SimContext, client: Id, dealId: Id): string | null {
  const { state, content } = ctx;
  const deal = state.outsideDeals.find((d) => d.id === dealId);
  if (!deal || deal.client !== client || deal.status !== 'open' || !deal.counter) return 'no counter-offer to accept';
  const blocked = dealBlocked(state, content, client, { cartel: deal.cartel, ask: deal.ask, offer: deal.counter, deal: deal.id });
  if (blocked) return blocked;
  return execute(ctx, deal, deal.counter);
}

export function walkAway(ctx: SimContext, client: Id, dealId: Id): string | null {
  const deal = ctx.state.outsideDeals.find((d) => d.id === dealId);
  if (!deal || deal.client !== client || deal.status !== 'open') return 'no open deal';
  deal.status = 'walked';
  deal.reason = 'you walked away';
  return null;
}

function walk(ctx: SimContext, deal: OutsideDeal, reason: string): void {
  const { state, content } = ctx;
  deal.status = 'walked';
  deal.reason = reason;
  state.outsiders[deal.cartel]!.silentUntil[deal.client] = state.hour + content.tuning.outside.walkAwayDays * 24;
  if (deal.client === state.playerId) pushFeed(state, 'important', `${cartelName(content, deal.cartel)} walked away from the table: ${reason}.`, null, networkOf(state, deal.client));
}

/** Close the deal: take payment, hand over plazas, deliver what was asked. */
function execute(ctx: SimContext, deal: OutsideDeal, offer: OutsideOffer): string | null {
  const { state, content } = ctx;
  const t = content.tuning.outside;
  const o = state.outsiders[deal.cartel]!;
  const head = cartelHead(content, deal.cartel);
  if (offer.cash > 0 && !spend(state, content, deal.client, offer.cash, 'foreign')) return 'you no longer have the cash';
  if (offer.cash > 0) deposit(state, content, head, offer.cash, 'deals');
  if (offer.retainer > 0 && offer.retainerWeeks > 0) o.payments.push({ by: deal.client, kind: 'retainer', amount: offer.retainer, until: state.hour + offer.retainerWeeks * 7 * 24 });
  if (offer.incomeShare > 0 && offer.incomeWeeks > 0) o.payments.push({ by: deal.client, kind: 'income_share', amount: offer.incomeShare, until: state.hour + offer.incomeWeeks * 7 * 24 });
  if (offer.plazaNow) handOver(ctx, deal.cartel, deal.client, offer.plazaNow);
  if (offer.plazaLater) o.promises.push({ by: deal.client, node: offer.plazaLater, dueAt: state.hour + t.promiseDueDays * 24 });
  deliver(ctx, deal);
  o.attitude[deal.client] = (o.attitude[deal.client] ?? 0) + t.attitude.paidDeal;
  deal.status = 'agreed';
  deal.offer = offer;
  deal.counter = null;
  deal.reason = null;
  if (deal.client === state.playerId) pushFeed(state, 'important', `Deal with ${cartelName(content, deal.cartel)}: ${askLabel(state, content, deal.ask)}.`, deal.ask.kind === 'men' ? deal.ask.node : null, networkOf(state, deal.client));
  return null;
}

export function askLabel(state: GameState, content: Content, ask: OutsideAsk): string {
  switch (ask.kind) {
    case 'men':
      return `${ask.men} ${tierName(content, ask.tier)} to ${world(content).node(ask.node).name}`;
    case 'weapons':
      return `new weapons for ${charName({ state, content } as SimContext, state.crews[ask.crew]?.leader ?? '')}'s crew`;
    case 'armored':
      return `${ask.count} armored truck${ask.count > 1 ? 's' : ''}`;
    case 'loan':
      return `a loan of ${money(ask.amount)}`;
  }
}

export function tierName(content: Content, tier: OutsideTier): string {
  return { carne: 'carne de cañón', sicarios: 'sicarios', elite: 'elite ex-military' }[tier];
}

function deliver(ctx: SimContext, deal: OutsideDeal): void {
  const { state, content } = ctx;
  const ask = deal.ask;
  switch (ask.kind) {
    case 'men': {
      const tier = cfg(content, deal.cartel).tiers[ask.tier]!;
      spawnCrew(state, content, deal.client, ask.node, ask.men, tier.skill, tier.gear, {
        kind: 'contingent',
        from: deal.cartel,
        loyalty: content.tuning.outside.loyalty.start,
        payMultiplier: 1,
        weekly: tier.weeklyPerMan * ask.men,
        recallAt: null,
        defectOffer: null,
      });
      break;
    }
    case 'weapons':
      state.crews[ask.crew]!.gear = ask.gear;
      break;
    case 'armored':
      state.crews[ask.crew]!.vehicles.armored += ask.count;
      break;
    case 'loan': {
      const l = content.tuning.outside.loan;
      deposit(state, content, deal.client, ask.amount, 'deals');
      state.outsiders[deal.cartel]!.loans.push({ by: deal.client, owed: ask.amount * (1 + l.interest), dueAt: state.hour + l.weeks * 7 * 24 });
      break;
    }
  }
}

function spawnCrew(state: GameState, content: Content, owner: Id, node: Id, men: number, skill: number, gear: number, hired: CrewState['hired']): CrewState {
  const id = newId(state, 'crew');
  const crew: CrewState = {
    id,
    owner,
    leader: owner,
    men,
    skill,
    gear,
    morale: content.tuning.crews.startingMorale,
    alertness: content.tuning.crews.startingAlertness,
    ammo: 100,
    fatigue: 0,
    vehicles: { pickup: Math.ceil(men / content.tuning.vehicles.pickup.seats), suv: 0, motorcycle: 0, armored: 0 },
    armorDamage: 0,
    location: { kind: 'node', node },
    order: { type: 'garrison' },
    transit: newTransit(),
    battle: null,
    colonia: null,
    battles: 0,
    establishment: men,
    training: null,
    hired,
  };
  state.crews[id] = crew;
  return crew;
}

/** A plaza changes hands to an outside cartel: their people and lookouts move in. */
function handOver(ctx: SimContext, cartel: Id, from: Id, node: Id): void {
  const { state, content } = ctx;
  const head = cartelHead(content, cartel);
  const ch = state.characters[head]!;
  const giver = state.characters[from]!;
  // Standing with the giver's side makes them an associate of that coalition.
  if (!state.outsiders[cartel]!.declared && giver.faction !== null && associateOf(state, cartel) === null) ch.faction = giver.faction;
  state.nodes[node]!.owner = head;
  const g = content.tuning.outside.plazaGarrison;
  spawnCrew(state, content, head, node, g.men, g.skill, g.gear, null);
  // A neutral giver and an unaligned cartel agree to leave each other be.
  if (networkOf(state, head) !== networkOf(state, from) && !state.pacts.some((p) => p.type === 'non_aggression' && p.parties.includes(head) && p.parties.includes(from))) {
    const parties: [Id, Id] = head < from ? [head, from] : [from, head];
    state.pacts.push({ id: newId(state, 'pact'), type: 'non_aggression', parties, secret: false, expiresAt: null, region: null, createdAt: state.hour });
  }
  const text = `${charName(ctx, from)} handed ${world(content).node(node).name} to ${cartelName(content, cartel)}.`;
  pushFeed(state, 'important', text, node, null);
}

// ---------------------------------------------------------------------------
// Contingents
// ---------------------------------------------------------------------------

/** Losses in a fight cost a contingent loyalty; wins earn it. */
export function contingentLosses(crew: CrewState, lostShare: number, content: Content): void {
  if (crew.hired?.kind !== 'contingent') return;
  crew.hired.loyalty = clamp(crew.hired.loyalty + lostShare * content.tuning.outside.loyalty.perLossShare);
}

export function contingentWon(crew: CrewState, content: Content): void {
  if (crew.hired?.kind !== 'contingent') return;
  crew.hired.loyalty = clamp(crew.hired.loyalty + content.tuning.outside.loyalty.perWin);
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function goHome(ctx: SimContext, crew: CrewState, why: string): void {
  const { state, content } = ctx;
  if (crew.battle !== null) return;
  for (const e of Object.values(state.crews)) if (e.order.type === 'escort' && e.order.crew === crew.id) e.order = { type: 'idle' };
  delete state.crews[crew.id];
  if (crew.owner === state.playerId) pushFeed(state, 'critical', `${crew.men} ${cartelName(content, crew.hired!.from ?? '')} men went home: ${why}.`, crew.location.kind === 'node' ? crew.location.node : crew.location.to, networkOf(state, crew.owner));
}

export function answerDefection(ctx: SimContext, owner: Id, crewId: Id, accept: boolean): string | null {
  const { state, content } = ctx;
  const crew = state.crews[crewId];
  if (!crew || crew.owner !== owner || crew.hired?.kind !== 'contingent' || crew.hired.defectOffer === null) return 'no such offer';
  const cartel = crew.hired.from!;
  if (!accept) {
    crew.hired.defectOffer = null;
    return null;
  }
  const o = state.outsiders[cartel]!;
  o.attitude[owner] = Math.min(o.attitude[owner] ?? 0, content.tuning.outside.loyalty.defectHostility);
  if (!o.hostile.includes(owner)) o.hostile.push(owner);
  crew.hired = null;
  if (owner === state.playerId) pushFeed(state, 'critical', `${crew.men} men left ${cartelName(content, cartel)} to stay with you. ${cartelName(content, cartel)} will not forget it.`, null, networkOf(state, owner));
  return null;
}

// ---------------------------------------------------------------------------
// Daily and weekly
// ---------------------------------------------------------------------------

export function runOutsidersDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const weekly = Math.floor(state.hour / 24) % 7 === 0;
  for (const cartel of outsideCartels(content)) {
    const o = state.outsiders[cartel];
    if (!o) continue;
    if (weekly) sendEnvoy(ctx, cartel, o);
    collectPromises(ctx, cartel, o);
    collectLoans(ctx, cartel, o);
    if (weekly) collectPayments(ctx, cartel, o);
    ambition(ctx, cartel, o);
    if (weekly) hostileRaids(ctx, cartel, o);
  }
  contingentsDaily(ctx, weekly);
  state.outsideDeals = state.outsideDeals.filter((d) => d.status === 'open' || state.hour - d.createdAt <= 14 * 24);
}

function eligibleClients(state: GameState): Id[] {
  return Object.keys(state.characters)
    .sort()
    .filter((id) => dealerBlocked(state, id) === null);
}

function sendEnvoy(ctx: SimContext, cartel: Id, o: OutsiderState): void {
  const { state, content } = ctx;
  if (!chance(state.rng, cfg(content, cartel).envoyChancePerWeek)) return;
  // Neutrals are courted first: they make the most attractive partners.
  const pool = eligibleClients(state).filter((id) => !o.hostile.includes(id) && !contactVia(state, content, id, cartel));
  if (!pool.length) return;
  const neutral = pool.filter((id) => state.characters[id]!.faction === null);
  const list = neutral.length ? neutral : pool;
  const who = list[Math.floor(rand(state.rng) * list.length)]!;
  o.envoys[who] = state.hour + content.tuning.outside.envoyContactDays * 24;
  if (who === state.playerId) pushFeed(state, 'important', `An envoy from ${cartelName(content, cartel)} came to talk. You can deal with them for ${content.tuning.outside.envoyContactDays} days (Diplomacy).`, null, networkOf(state, who));
}

function collectPromises(ctx: SimContext, cartel: Id, o: OutsiderState): void {
  const { state, content } = ctx;
  const t = content.tuning.outside;
  const due = o.promises.filter((p) => p.dueAt <= state.hour);
  if (!due.length) return;
  o.promises = o.promises.filter((p) => p.dueAt > state.hour);
  for (const p of due) {
    const name = world(content).node(p.node).name;
    if (state.nodes[p.node]?.owner === p.by && state.characters[p.by]?.status !== 'dead') {
      handOver(ctx, cartel, p.by, p.node);
      o.attitude[p.by] = (o.attitude[p.by] ?? 0) + t.attitude.keptPromise;
      if (p.by === state.playerId) pushFeed(state, 'important', `${cartelName(content, cartel)} came to collect ${name}, as promised.`, p.node, networkOf(state, p.by));
    } else {
      sour(ctx, cartel, o, p.by, t.attitude.brokenPromise, `you promised them ${name}`);
    }
  }
}

function sour(ctx: SimContext, cartel: Id, o: OutsiderState, who: Id, by: number, why: string): void {
  const { state, content } = ctx;
  o.attitude[who] = (o.attitude[who] ?? 0) + by;
  const hostile = o.attitude[who]! <= content.tuning.outside.attitude.hostileBelow && !o.hostile.includes(who);
  if (hostile) o.hostile.push(who);
  if (who === state.playerId) pushFeed(state, 'critical', `${cartelName(content, cartel)} is angry: ${why}.${hostile ? ' They are coming for you.' : ''}`, null, networkOf(state, who));
}

function collectLoans(ctx: SimContext, cartel: Id, o: OutsiderState): void {
  const { state, content } = ctx;
  const l = content.tuning.outside.loan;
  for (const loan of o.loans.filter((x) => x.dueAt <= state.hour)) {
    const paid = spendUpTo(state, content, loan.by, loan.owed, 'foreign');
    if (paid > 0) deposit(state, content, cartelHead(content, cartel), paid, 'deals');
    if (paid + 1e-6 < loan.owed) {
      o.ambition = Math.min(100, o.ambition + l.defaultAmbition);
      sour(ctx, cartel, o, loan.by, l.defaultAttitude, `you paid back ${money(paid)} of ${money(loan.owed)}`);
    } else if (loan.by === state.playerId) pushFeed(state, 'routine', `Paid ${cartelName(content, cartel)} back ${money(paid)}.`, null, networkOf(state, loan.by));
  }
  o.loans = o.loans.filter((x) => x.dueAt > state.hour);
}

function collectPayments(ctx: SimContext, cartel: Id, o: OutsiderState): void {
  const { state, content } = ctx;
  o.payments = o.payments.filter((p) => p.until > state.hour);
  for (const p of o.payments) {
    const owed = p.kind === 'retainer' ? p.amount : p.amount * weeklyIncome(state, p.by);
    if (owed <= 0) continue;
    const paid = spendUpTo(state, content, p.by, owed, 'foreign');
    if (paid > 0) deposit(state, content, cartelHead(content, cartel), paid, 'deals');
    if (paid + 1e-6 < owed) sour(ctx, cartel, o, p.by, content.tuning.outside.loyalty.weeklyMissed, `you owed them ${money(owed)} this week`);
  }
}

function ambition(ctx: SimContext, cartel: Id, o: OutsiderState): void {
  const { state, content } = ctx;
  if (o.declared) return;
  const a = content.tuning.outside.ambition;
  const growth = cfg(content, cartel).ambitionGrowth;
  const head = cartelHead(content, cartel);
  const held = Object.values(state.nodes).filter((n) => n.owner === head).length;
  const partner = associateOf(state, cartel);
  const share = partner ? (territoryShares(state, content).get(partner) ?? 0) : 1;
  let d = held * a.perDayStrongPlaza * growth;
  if (partner && share < a.partnerWeakShare) d += a.perDayWeak * growth;
  if (d <= 0) d = -a.decayPerDay;
  o.ambition = Math.max(0, Math.min(100, o.ambition + d));
  if (o.ambition < a.declareAt || held === 0) return;
  o.declared = true;
  state.characters[head]!.faction = cartel;
  pushFeed(state, 'critical', `${cartelName(content, cartel)} declared for itself: its plazas in Sinaloa answer to no one now.`, null, null);
}

/** A cartel that was wronged sends men after the boss who wronged it. */
function hostileRaids(ctx: SimContext, cartel: Id, o: OutsiderState): void {
  const { state, content } = ctx;
  const head = cartelHead(content, cartel);
  const w = world(content);
  for (const who of [...o.hostile].sort()) {
    if (state.characters[who]?.status !== 'free') continue;
    if (networkOf(state, who) === networkOf(state, head)) continue;
    if (!chance(state.rng, content.tuning.outside.hostile.raidChancePerWeek)) continue;
    const target = Object.keys(state.nodes)
      .sort()
      .find((n) => state.nodes[n]!.owner === who && n !== content.culiacan.parentNode && w.neighbors(n).length > 0);
    if (!target) continue;
    const exits = content.nodes.filter((n) => n.type === 'border_exit').map((n) => n.id).sort();
    if (!exits.length) continue;
    const from = exits[Math.floor(rand(state.rng) * exits.length)]!;
    const g = content.tuning.outside;
    const crew = spawnCrew(state, content, head, from, g.hostile.raidMen, g.plazaGarrison.skill, g.plazaGarrison.gear, null);
    if (orderCrew(ctx, crew, { type: 'raid', target, preference: 'fastest' }) !== null) {
      delete state.crews[crew.id];
      continue;
    }
    if (who === state.playerId) pushFeed(state, 'critical', `${cartelName(content, cartel)} gunmen crossed into Sinaloa, heading for ${w.node(target).name}.`, target, networkOf(state, who));
  }
}

function contingentsDaily(ctx: SimContext, weekly: boolean): void {
  const { state, content } = ctx;
  const l = content.tuning.outside.loyalty;
  for (const id of Object.keys(state.crews).sort()) {
    const crew = state.crews[id];
    if (!crew || crew.hired?.kind !== 'contingent') continue;
    const h = crew.hired;
    const owner = state.characters[crew.owner];
    if (!owner || owner.status === 'dead' || owner.status === 'extradited') {
      goHome(ctx, crew, 'their boss is gone');
      continue;
    }
    if (h.recallAt !== null && state.hour >= h.recallAt) {
      goHome(ctx, crew, `${cartelName(content, h.from ?? '')} called them back`);
      continue;
    }
    if (weekly) h.loyalty = clamp(h.loyalty + (owner.missedPayrollWeeks > 0 ? l.weeklyMissed : l.weeklyPaid));
    if (h.loyalty <= 0) {
      goHome(ctx, crew, 'they had enough');
      continue;
    }
    if (h.loyalty < l.desertBelow && crew.battle === null) {
      const gone = Math.max(1, Math.floor(crew.men * l.desertShareDaily));
      if (crew.men - gone < 1) {
        goHome(ctx, crew, 'the last of them deserted');
        continue;
      }
      crew.men -= gone;
    }
    if (!weekly || h.recallAt !== null) continue;
    if (chance(state.rng, cfg(content, h.from!).recallChancePerWeek)) {
      h.recallAt = state.hour + content.tuning.outside.recallWarningHours;
      if (crew.owner === state.playerId) pushFeed(state, 'critical', `${cartelName(content, h.from!)} is calling its ${crew.men} men home; they leave in ${content.tuning.outside.recallWarningHours} hours.`, null, networkOf(state, crew.owner));
      continue;
    }
    if (h.defectOffer === null && h.loyalty >= l.defectAbove && chance(state.rng, l.defectChancePerWeek)) {
      h.defectOffer = state.hour;
      if (crew.owner === state.playerId) pushFeed(state, 'critical', `${crew.men} ${cartelName(content, h.from!)} men offer to stay as your own. Taking them makes ${cartelName(content, h.from!)} an enemy (Forces).`, null, networkOf(state, crew.owner));
    }
  }
}
