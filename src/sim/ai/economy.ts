/**
 * AI economy, once a day per AI character: refill crews toward full strength
 * when the money allows, squeeze harder when broke, and ease off where locals
 * turn. GDD: "Economy", "AI".
 */
import type { ExtortionRate } from '../../data/schemas';
import type { Command } from '../commands';
import type { SimContext } from '../context';
import { cashOf, ledgerTotals } from '../money';
import { seats } from '../signature';
import { characterTerritory, weeklyObligations } from '../systems/economy';
import { aiManaged, stagger } from './util';
import { crewPayPerWeek, trainingCostPerDay, weaponsCost } from '../forces';
import { onOperation } from '../operations';
import { onDuty } from '../requests';
import type { Id, PlazaState } from '../state';

const RATES: ExtortionRate[] = ['low', 'medium', 'high', 'brutal'];

/**
 * Once a day per AI character: refill crews toward full strength when the
 * money allows, squeeze harder when broke, and ease off where locals turn.
 */
export function runEconomy(ctx: SimContext): Command[] {
  const { state, content } = ctx;
  const e = content.tuning.economy;
  const cmds: Command[] = [];
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (!aiManaged(state, id)) continue;
    if ((state.hour + stagger(id, 24)) % 24 !== 12) continue;
    const plazas = Object.values(state.nodes)
      .filter((n) => n.owner === id)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!plazas.length) continue;
    const weekly = weeklyObligations(state, content, id);
    let cash = cashOf(state, id);
    const broke = ch.missedPayrollWeeks > 0 || cash < weekly;

    if (!broke) {
      const reserve = content.tuning.ai.economyReserveWeeks * weekly;
      for (const crew of Object.values(state.crews).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        if (crew.owner !== id || crew.battle !== null || crew.location.kind !== 'node') continue;
        const plaza = state.nodes[crew.location.node];
        if (!plaza || plaza.owner !== id) continue;
        const need = Math.min(crew.establishment - crew.men, Math.floor(plaza.recruits), content.tuning.crews.maxMen - crew.men);
        if (need <= 0) continue;
        const seatsShort = Math.max(0, crew.men + need - seats(crew, content.tuning));
        const pickups = Math.ceil(seatsShort / content.tuning.vehicles.pickup.seats);
        const cost = need * e.recruitment.signingCostPerMan + pickups * content.tuning.vehicles.pickup.cost;
        if (cash - cost < reserve) continue;
        if (pickups > 0) cmds.push({ type: 'buy_vehicles', issuer: id, crew: crew.id, vehicle: 'pickup', count: pickups });
        cmds.push({ type: 'recruit', issuer: id, crew: crew.id, men: need });
        cash -= cost;
      }
    }

    // Crews lost for good are replaced with new ones, raised where recruits are plentiful.
    if (!broke) {
      const fielded = Object.values(state.crews)
        .filter((c) => c.owner === id)
        .reduce((n, c) => n + c.men, 0);
      const { minMen, maxMen } = content.tuning.crews;
      const g = content.tuning.ai.forceGrowth;
      const growth =
        ch.baseTerritory > 0 && state.hour >= g.startDay * 24 ? Math.max(g.min, Math.min(g.max, characterTerritory(state, content, id) / ch.baseTerritory)) : 1;
      const shortfall = Math.round(ch.forceTarget * growth) - fielded;
      const base = [...plazas].sort((a, b) => b.recruits - a.recruits || (a.id < b.id ? -1 : 1))[0]!;
      const men = Math.min(maxMen, shortfall, Math.floor(base.recruits));
      const cost = men * e.recruitment.signingCostPerMan + Math.ceil(men / content.tuning.vehicles.pickup.seats) * content.tuning.vehicles.pickup.cost;
      if (shortfall >= minMen && men >= minMen && cash - cost >= content.tuning.ai.economyReserveWeeks * weekly) {
        cmds.push({ type: 'form_crew', issuer: id, node: base.id, men });
        cash -= cost;
      }
    }

    if (!broke) cmds.push(...forces(ctx, id, plazas, weekly, () => cash, (n) => (cash -= n)));

    for (const p of plazas) {
      const i = RATES.indexOf(p.extortionRate);
      if (p.support < 25 && i >= 2) cmds.push({ type: 'set_extortion_rate', issuer: id, node: p.id, rate: RATES[i - 1]! });
    }
    if (broke) {
      const richest = [...plazas].sort((a, b) => b.businesses - a.businesses)[0]!;
      const i = RATES.indexOf(richest.extortionRate);
      if (i < 2 && richest.support >= 35) cmds.push({ type: 'set_extortion_rate', issuer: id, node: richest.id, rate: RATES[i + 1]! });
      const watched = [...plazas].sort((a, b) => b.halconCoverage - a.halconCoverage)[0]!;
      if (watched.halconCoverage > 30) cmds.push({ type: 'set_halcon_coverage', issuer: id, node: watched.id, coverage: watched.halconCoverage - 10 });
    }
  }
  return cmds;
}

/** Better men and guns when the money allows; mercenaries when a plaza is under fire. */
function forces(ctx: SimContext, id: Id, plazas: PlazaState[], weekly: number, cash: () => number, pay: (n: number) => void): Command[] {
  const { state, content } = ctx;
  const a = content.tuning.ai.forces;
  const f = content.tuning.forces;
  const cmds: Command[] = [];
  // Income a week, from the ledger; new pay must fit inside what is left after bills.
  const ch = state.characters[id]!;
  const days = Math.min(7, ch.ledger.length);
  const income = days > 0 ? (ledgerTotals(state, id, days).income * 7) / days : 0;
  let surplus = income - weekly;
  const affords = (extraPay: number) => surplus >= extraPay * a.payCover;
  const mine = Object.values(state.crews)
    .filter((c) => c.owner === id && c.battle === null && c.location.kind === 'node' && state.nodes[c.location.node]?.owner === id && c.order.type === 'garrison' && !onDuty(state, c.id) && !onOperation(state, c.id))
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  // Weapons first: no one should be carrying pistols.
  const unarmed = mine.find((c) => c.gear < a.weaponsTargetGear);
  if (unarmed) {
    const cost = weaponsCost(content.tuning, unarmed, a.weaponsTargetGear);
    if (cash() - cost >= a.weaponsReserveWeeks * weekly) {
      cmds.push({ type: 'buy_weapons', issuer: id, crew: unarmed.id, gear: a.weaponsTargetGear });
      pay(cost);
    }
  }
  // One new camp at a time.
  if (!Object.values(state.crews).some((c) => c.owner === id && c.training)) {
    const pupil = mine.find((c) => c.skill < f.training.maxSkill && c.location.kind === 'node' && c.location.node !== content.culiacan.parentNode);
    if (pupil && pupil.location.kind === 'node') {
      const budget = trainingCostPerDay(ctx, pupil, pupil.location.node) * a.trainBudgetDays;
      const raise = crewPayPerWeek(content.tuning, { ...pupil, skill: pupil.skill + 1 }) - crewPayPerWeek(content.tuning, pupil);
      if (cash() - budget >= a.trainReserveWeeks * weekly && affords(raise + budget / (a.trainBudgetDays / 7))) {
        cmds.push({ type: 'train_crew', issuer: id, crew: pupil.id });
        pay(budget);
      }
    }
  }
  // Veterans top up a crew the local pool cannot.
  const short = mine.find((c) => c.men < c.establishment && state.nodes[(c.location as { node: Id }).node]!.recruits < 1);
  if (short && state.market.veterans > 0) {
    const men = Math.min(short.establishment - short.men, state.market.veterans, seats(short, content.tuning) - short.men);
    const cost = men * f.veterans.costPerMan;
    const extra = men * content.tuning.economy.payrollPerManPerWeek * f.payBySkill[f.veterans.skill - 1]!;
    if (men > 0 && cash() - cost >= a.veteransReserveWeeks * weekly && affords(extra)) {
      cmds.push({ type: 'hire_veterans', issuer: id, crew: short.id, men });
      pay(cost);
      surplus -= extra;
    }
  }
  // Mercenaries for a plaza under fire.
  const hot = plazas.find((p) => p.lastBattleAt !== null && state.hour - p.lastBattleAt <= a.mercAfterBattleDays * 24 && p.id !== content.culiacan.parentNode);
  const men = Math.max(f.mercenaries.minMen, Math.min(f.mercenaries.maxMen, a.mercMen));
  const cost = men * f.mercenaries.costPerMan;
  const hiredAlready = Object.values(state.crews).some((c) => c.owner === id && c.hired?.kind === 'mercenary');
  const mercPay = men * content.tuning.economy.payrollPerManPerWeek * f.payBySkill[f.mercenaries.skill - 1]! * f.mercenaries.payMultiplier;
  if (hot && !hiredAlready && cash() - cost >= a.mercReserveWeeks * weekly && affords(mercPay)) {
    cmds.push({ type: 'hire_mercenaries', issuer: id, node: hot.id, men });
    pay(cost);
  }
  return cmds;
}
