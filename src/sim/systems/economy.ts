/**
 * Money is the war's fuel: income settles daily, payroll and halcones are
 * paid weekly, aligned characters pay tribute, and an unpaid army deserts.
 * Also runs the recruit pools, the armored-truck market, and the effect of
 * extortion and fighting on businesses and support. GDD: "Economy".
 */
import { crewPayPerWeek, mercenariesLeave, restockVeterans } from '../forces';
import type { Content } from '../../data/content';
import { pushFeed, type SimContext } from '../context';
import { cashOf, deposit, spend, spendUpTo } from '../money';
import { networkOf } from '../network';
import type { CrewState, GameState, Id, IncomeStream, NetworkId } from '../state';
import { payShares } from '../pacts';
import { world } from '../world';

/** One line of daily income: who gets it, from where, and why. */
export interface IncomeLine {
  recipient: Id;
  /** Plaza the money is earned in (its stash receives it), if any. */
  node: Id | null;
  stream: IncomeStream;
  amount: number;
  /** Route or colonia the line comes from, for the ledger. */
  source: string;
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

/** Faction holding a Culiacán colonia, or null while it is contested. */
export function coloniaHolder(state: GameState, content: Content, colonia: Id): NetworkId | null {
  const control = state.colonias[colonia]?.control ?? 0;
  const flip = content.tuning.map.coloniaFlipThreshold;
  const pos = content.culiacan.positiveFaction;
  if (control >= flip) return pos;
  if (control <= -flip) return content.factions.find((f) => f.kind === 'major' && f.id !== pos)?.id ?? null;
  return null;
}

function freeHead(state: GameState, faction: NetworkId): Id | null {
  const head = state.factions[faction]?.head;
  return head && !['dead', 'extradited'].includes(state.characters[head]?.status ?? 'dead') ? head : null;
}

/** Who collects a colonia's money: the owner of the biggest holding crew there, else the faction head. */
function coloniaRecipient(state: GameState, content: Content, colonia: Id): Id | null {
  const holder = coloniaHolder(state, content, colonia);
  if (!holder) return null;
  const city = content.culiacan.parentNode;
  const crews = Object.values(state.crews)
    .filter((c) => c.colonia === colonia && c.location.kind === 'node' && c.location.node === city && networkOf(state, c.owner) === holder)
    .sort((a, b) => b.men - a.men || (a.id < b.id ? -1 : 1));
  return crews[0]?.owner ?? freeHead(state, holder);
}

/** Who collects a node's route share: its owner, or for Culiacán the head of the side holding more colonias. */
export function nodeRecipient(state: GameState, content: Content, node: Id): Id | null {
  if (node !== content.culiacan.parentNode) return state.nodes[node]?.owner ?? null;
  const count = new Map<NetworkId, number>();
  for (const col of content.culiacan.colonias) {
    const h = coloniaHolder(state, content, col.id);
    if (h) count.set(h, (count.get(h) ?? 0) + 1);
  }
  const ranked = [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0]![1])) return null;
  return freeHead(state, ranked[0]![0]);
}

export function compliance(state: GameState, content: Content, node: Id, recipient: Id): number {
  const c = content.tuning.economy.compliance;
  const plaza = state.nodes[node]!;
  const fear = state.characters[recipient]?.fear ?? 0;
  const v = c.base + plaza.support * c.perSupport + fear * c.perFear - plaza.militaryPresence * c.perMilitaryPresence;
  return Math.min(c.max, Math.max(c.min, v));
}

/** A node is contested if there was fighting in its region today or a battle is on there. */
function contested(state: GameState, content: Content, node: Id): boolean {
  const region = world(content).node(node).region;
  if ((state.regions[region]?.combatHoursToday ?? 0) > 0) return true;
  return Object.values(state.battles).some((b) => b.endedAt === null && b.where.kind === 'node' && b.where.node === node);
}

/** Every line of income the map produces today. Pure: the UI uses it for forecasts. */
export function dailyIncome(state: GameState, content: Content): IncomeLine[] {
  const e = content.tuning.economy;
  const lines: IncomeLine[] = [];
  const city = content.culiacan.parentNode;

  for (const n of content.nodes) {
    const plaza = state.nodes[n.id]!;
    if (n.id === city || !plaza.owner) continue;
    const owner = plaza.owner;
    const rate = e.extortionRates[plaza.extortionRate].incomePerBusinessPerDay;
    lines.push({ recipient: owner, node: n.id, stream: 'extortion', amount: plaza.businesses * rate * compliance(state, content, n.id, owner), source: n.id });
    lines.push({ recipient: owner, node: n.id, stream: 'rackets', amount: plaza.businesses * e.racketPerBusinessPerDay * (plaza.support / 100), source: n.id });
    if (plaza.labs > 0) lines.push({ recipient: owner, node: n.id, stream: 'labs', amount: plaza.labs * e.labOutputPerDay, source: n.id });
  }

  // Culiacán pays by colonia, to whoever holds each one.
  const cityPlaza = state.nodes[city]!;
  for (const col of content.culiacan.colonias) {
    const who = coloniaRecipient(state, content, col.id);
    if (!who) continue;
    const rate = e.extortionRates[cityPlaza.extortionRate].incomePerBusinessPerDay;
    lines.push({ recipient: who, node: null, stream: 'extortion', amount: col.businesses * rate * compliance(state, content, city, who), source: col.id });
    lines.push({ recipient: who, node: null, stream: 'rackets', amount: col.businesses * e.racketPerBusinessPerDay * (cityPlaza.support / 100), source: col.id });
  }

  for (const route of content.routes) {
    const contestedCount = route.nodes.filter((n) => contested(state, content, n)).length;
    const throughput = Math.max(0, 1 - e.contestedRouteThroughputPenalty) ** contestedCount;
    const share = (route.dailyValue * throughput) / route.nodes.length;
    const sourceHolder = nodeRecipient(state, content, route.nodes[0]!);
    const sourceNet = sourceHolder ? networkOf(state, sourceHolder) : null;
    for (const n of route.nodes) {
      const who = nodeRecipient(state, content, n);
      if (!who) continue;
      const stream: IncomeStream = sourceNet !== null && networkOf(state, who) === sourceNet ? 'trafficking' : 'tolls';
      lines.push({ recipient: who, node: n === city ? null : n, stream, amount: share, source: route.id });
    }
  }
  return lines.filter((l) => l.amount > 0);
}

export function settleDailyIncome(ctx: SimContext): void {
  const { state, content } = ctx;
  const e = content.tuning.economy;
  restockMarket(ctx);
  growRecruitPools(ctx);
  fightingHurtsBusiness(ctx);

  const totals = new Map<Id, number>();
  const routeIncome = new Map<Id, number>();
  const paidLines: { recipient: Id; amount: number; source: Id; node: Id | null }[] = [];
  const w = world(content);
  const quiet = content.tuning.state.lieLow.incomeMultiplier;
  for (const line of dailyIncome(state, content)) {
    if (state.characters[line.recipient]?.status === 'dead' || state.characters[line.recipient]?.status === 'extradited') continue;
    // Lying low: business slows in the regions you are keeping quiet in.
    const low = line.node !== null && state.lieLow.some((l) => l.owner === line.recipient && l.region === w.node(line.node!).region && l.until > state.hour);
    const amount = low ? line.amount * quiet : line.amount;
    deposit(state, content, line.recipient, amount, line.stream, line.node);
    paidLines.push({ recipient: line.recipient, amount, source: line.source, node: line.node });
    totals.set(line.recipient, (totals.get(line.recipient) ?? 0) + amount);
    if (line.stream === 'trafficking' || line.stream === 'tolls') routeIncome.set(line.recipient, (routeIncome.get(line.recipient) ?? 0) + amount);
  }

  // Route and income shares agreed in pacts.
  payShares(ctx, paidLines);

  // Outside partners take their cut of the routes.
  for (const [id, income] of [...routeIncome].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (state.characters[id]?.foreignAlly) spendUpTo(state, content, id, income * content.tuning.diplomacy.foreignRouteCutMin, 'foreign');
  }

  // Aligned characters pay their faction head a share of the day's income.
  const factionIncome = new Map<NetworkId, number>();
  for (const [id, income] of [...totals].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const ch = state.characters[id]!;
    if (ch.faction) factionIncome.set(ch.faction, (factionIncome.get(ch.faction) ?? 0) + income);
    const head = ch.faction ? freeHead(state, ch.faction) : null;
    if (!head || head === id) continue;
    const paid = spendUpTo(state, content, id, income * e.factionTributeRate, 'tribute');
    deposit(state, content, head, paid, 'tribute');
  }

  // Faction Supply regenerates from income.
  for (const [faction, income] of factionIncome) {
    const f = state.factions[faction];
    if (f) f.supply = Math.min(100, f.supply + income / e.supplyPerIncome);
  }

  deserters(ctx);
}

// ---------------------------------------------------------------------------
// Weekly bills
// ---------------------------------------------------------------------------

export function payrollDue(state: GameState, content: Content, id: Id): number {
  return Object.values(state.crews)
    .filter((c) => c.owner === id)
    .reduce((n, c) => n + crewPayPerWeek(content.tuning, c), 0);
}

export function halconesDue(state: GameState, content: Content, id: Id): number {
  return Object.values(state.nodes)
    .filter((n) => n.owner === id)
    .reduce((n, p) => n + (p.halconCoverage / 10) * content.tuning.economy.halconCostPer10CoveragePerWeek, 0);
}

/** Payroll plus halcones for a week. */
export function weeklyObligations(state: GameState, content: Content, id: Id): number {
  return payrollDue(state, content, id) + halconesDue(state, content, id);
}

export function payWeeklyPayroll(ctx: SimContext): void {
  const { state, content } = ctx;
  const e = content.tuning.economy;
  const payers = Object.keys(state.characters)
    .sort()
    .filter((id) => state.characters[id]!.status !== 'dead' && state.characters[id]!.status !== 'extradited');
  for (const id of payers) {
    payCrews(ctx, id);
    payHalcones(ctx, id);
  }
  restockVeterans(state, content.tuning);
  // Extortion's weekly toll on support and businesses; quiet towns slowly reopen.
  for (const n of content.nodes) {
    const plaza = state.nodes[n.id]!;
    if (!plaza.owner) continue;
    const rate = e.extortionRates[plaza.extortionRate];
    plaza.support = Math.min(100, Math.max(0, plaza.support + rate.supportPerWeek));
    plaza.businesses *= 1 - rate.businessClosurePerWeek;
    if (rate.businessClosurePerWeek <= 0.01) plaza.businesses = Math.min(n.businesses, plaza.businesses + n.businesses * e.businessRecoveryPerWeek);
  }
}

function payCrews(ctx: SimContext, id: Id): void {
  const { state, content } = ctx;
  const e = content.tuning.economy;
  const ch = state.characters[id]!;
  const due = payrollDue(state, content, id);
  if (due <= 0) return;
  const net = networkOf(state, id);
  if (spend(state, content, id, due, 'payroll')) {
    if (ch.missedPayrollWeeks > 0 && id === state.playerId) pushFeed(state, 'important', 'Your men are paid again.', null, net);
    ch.missedPayrollWeeks = 0;
    return;
  }
  ch.missedPayrollWeeks += 1;
  mercenariesLeave(ctx, id);
  for (const c of Object.values(state.crews)) {
    if (c.owner !== id) continue;
    c.morale = Math.max(0, c.morale - e.missedPayroll.moraleLoss);
    if (c.leader !== id) {
      const leader = state.characters[c.leader];
      if (leader) (leader.opinions[id] ??= []).push({ key: 'paid_late', value: -e.missedPayroll.leaderOpinionLoss, addedAt: state.hour, decayDays: 30 });
    }
  }
  if (id === state.playerId) {
    const text =
      ch.missedPayrollWeeks >= e.missedPayroll.consecutiveWeeksForDesertion
        ? `Payroll missed again ($${Math.round(due).toLocaleString()} due). Your men have started to desert.`
        : `You could not make payroll ($${Math.round(due).toLocaleString()} due). Morale is falling; miss another week and men will desert.`;
    pushFeed(state, 'critical', text, null, net);
  }
}

function payHalcones(ctx: SimContext, id: Id): void {
  const { state, content } = ctx;
  const per10 = content.tuning.economy.halconCostPer10CoveragePerWeek;
  const plazas = Object.values(state.nodes)
    .filter((n) => n.owner === id && n.halconCoverage > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of plazas) {
    const cost = (p.halconCoverage / 10) * per10;
    if (spend(state, content, id, cost, 'halcones')) continue;
    const affordable = Math.floor(cashOf(state, id) / per10) * 10;
    const kept = Math.min(p.halconCoverage, affordable);
    spend(state, content, id, (kept / 10) * per10, 'halcones');
    if (id === state.playerId) {
      pushFeed(state, 'critical', `Unpaid halcones in ${world(content).node(p.id).name} walked away: coverage ${p.halconCoverage} → ${kept}.`, p.id, networkOf(state, id));
    }
    p.halconCoverage = kept;
  }
}

/** Two missed paydays in a row and men walk away every day. */
function deserters(ctx: SimContext): void {
  const { state, content } = ctx;
  const mp = content.tuning.economy.missedPayroll;
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (ch.missedPayrollWeeks < mp.consecutiveWeeksForDesertion) continue;
    let gone = 0;
    for (const c of Object.values(state.crews).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (c.owner !== id || c.battle !== null) continue;
      const leave = Math.ceil(c.men * mp.desertionRatePerDay);
      c.men -= leave;
      gone += leave;
      if (c.men <= 0) removeCrew(state, c);
    }
    if (gone && id === state.playerId) pushFeed(state, 'critical', `${gone} unpaid men deserted today.`, null, networkOf(state, id));
  }
}

function removeCrew(state: GameState, c: CrewState): void {
  for (const e of Object.values(state.crews)) if (e.order.type === 'escort' && e.order.crew === c.id) e.order = { type: 'idle' };
  delete state.crews[c.id];
}

// ---------------------------------------------------------------------------
// Recruits, the market, and the civilian cost of fighting
// ---------------------------------------------------------------------------

export function recruitPoolCap(content: Content, node: Id, businesses: number): number {
  const r = content.tuning.economy.recruitment;
  return (r.poolPerDayByType[world(content).node(node).type] + businesses * r.poolPerBusinessPerDay) * r.poolCapDays;
}

function growRecruitPools(ctx: SimContext): void {
  const { state, content } = ctx;
  const r = content.tuning.economy.recruitment;
  for (const n of content.nodes) {
    const plaza = state.nodes[n.id]!;
    if (!plaza.owner) continue;
    const respect = state.characters[plaza.owner]?.respect ?? 0;
    const daily = (r.poolPerDayByType[n.type] + plaza.businesses * r.poolPerBusinessPerDay) * (plaza.support / 100) * (1 + Math.max(-0.5, Math.min(1, respect / 100)));
    plaza.recruits = Math.min(recruitPoolCap(content, n.id, plaza.businesses), plaza.recruits + daily);
  }
}

function restockMarket(ctx: SimContext): void {
  const { state, content } = ctx;
  const e = content.tuning.economy;
  while (state.hour >= state.market.nextRestockAt) {
    state.market.armored += 1;
    state.market.nextRestockAt += e.armoredRestockDays * 24;
  }
}

function fightingHurtsBusiness(ctx: SimContext): void {
  const { state, content } = ctx;
  const e = content.tuning.economy;
  for (const plaza of Object.values(state.nodes)) {
    const h = plaza.combatHoursToday;
    if (h > 0) {
      plaza.businesses *= Math.max(0, 1 - e.businessLossPerCombatHour * h);
      plaza.support = Math.max(0, plaza.support - e.supportLossPerCombatHour * h);
    }
    plaza.combatHoursWeek = plaza.combatHoursWeek * content.tuning.events.combatWeekKeep + h;
    plaza.combatHoursToday = 0;
  }
}

// ---------------------------------------------------------------------------
// Plaza value and territorial share
// ---------------------------------------------------------------------------

/**
 * A plaza's steady daily worth: extortion at a medium rate, rackets, labs,
 * and its base share of every route through it. Used for targeting and for
 * the territorial-defeat share, so it ignores today's fighting.
 */
export function nodeValue(state: GameState, content: Content, node: Id): number {
  const e = content.tuning.economy;
  const plaza = state.nodes[node];
  if (!plaza || world(content).node(node).type === 'border_exit') return 0;
  const typical = e.compliance.base + plaza.support * e.compliance.perSupport;
  let v = 0;
  if (node !== content.culiacan.parentNode) {
    v += plaza.businesses * (e.extortionRates.medium.incomePerBusinessPerDay * typical + e.racketPerBusinessPerDay * (plaza.support / 100));
    v += plaza.labs * e.labOutputPerDay;
  }
  for (const r of content.routes) if (r.nodes.includes(node)) v += r.dailyValue / r.nodes.length;
  return v;
}

export function coloniaValue(state: GameState, content: Content, colonia: Id): number {
  const e = content.tuning.economy;
  const col = content.culiacan.colonias.find((c) => c.id === colonia);
  const city = state.nodes[content.culiacan.parentNode]!;
  if (!col) return 0;
  return col.businesses * (e.extortionRates.medium.incomePerBusinessPerDay * (e.compliance.base + city.support * e.compliance.perSupport) + e.racketPerBusinessPerDay * (city.support / 100));
}

/**
 * Each network's share of all plaza value. Culiacán counts colonia by colonia
 * (plus its route shares to whoever holds more colonias).
 */
export function territoryShares(state: GameState, content: Content): Map<NetworkId, number> {
  const value = new Map<NetworkId, number>();
  let total = 0;
  const add = (net: NetworkId | null, v: number) => {
    total += v;
    if (net) value.set(net, (value.get(net) ?? 0) + v);
  };
  const city = content.culiacan.parentNode;
  for (const n of content.nodes) {
    const v = nodeValue(state, content, n.id);
    if (n.id === city) {
      const who = nodeRecipient(state, content, city);
      add(who ? networkOf(state, who) : null, v);
      continue;
    }
    const owner = state.nodes[n.id]!.owner;
    add(owner ? networkOf(state, owner) : null, v);
  }
  for (const col of content.culiacan.colonias) add(coloniaHolder(state, content, col.id), coloniaValue(state, content, col.id));
  const shares = new Map<NetworkId, number>();
  for (const [k, v] of value) shares.set(k, total > 0 ? v / total : 0);
  return shares;
}

/** Plaza value held by one character (their plazas only). */
export function characterTerritory(state: GameState, content: Content, id: Id): number {
  return Object.values(state.nodes)
    .filter((n) => n.owner === id)
    .reduce((sum, n) => sum + nodeValue(state, content, n.id), 0);
}
