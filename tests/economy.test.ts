import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/commands';
import { cashOf, moveCash, spend } from '../src/sim/money';
import { newGame } from '../src/sim/newGame';
import type { GameState } from '../src/sim/state';
import { compliance, dailyIncome, payrollDue } from '../src/sim/systems/economy';
import { tick } from '../src/sim/tick';
import { addCrew, calm, empty, tuned } from './helpers';

const e = calm.tuning.economy;
/** The campaign starts on a Monday at 00:00; the first payday is Sunday 00:00. */
const FIRST_PAYDAY = 6 * 24;

function step(s: GameState, cmds: Command[] = []) {
  const r = tick(s, cmds, calm);
  expect(r.rejected).toEqual([]);
  return r.state;
}

function runTo(s: GameState, hour: number): GameState {
  while (s.hour < hour) s = tick(s, [], calm).state;
  return s;
}

const lines = (s: GameState, who: string) => dailyIncome(s, calm).filter((l) => l.recipient === who);
const sum = (ls: { amount: number }[]) => ls.reduce((n, l) => n + l.amount, 0);

describe('income', () => {
  it('extortion = businesses × rate × compliance', () => {
    const s = empty();
    const p = s.nodes.guasave!;
    const c = compliance(s, calm, 'guasave', 'm_guasave');
    expect(c).toBeCloseTo(e.compliance.base + p.support * e.compliance.perSupport - p.militaryPresence * e.compliance.perMilitaryPresence);
    const ext = lines(s, 'm_guasave').find((l) => l.stream === 'extortion' && l.source === 'guasave')!;
    expect(ext.amount).toBeCloseTo(p.businesses * e.extortionRates.medium.incomePerBusinessPerDay * c);
    p.extortionRate = 'brutal';
    const brutal = lines(s, 'm_guasave').find((l) => l.stream === 'extortion' && l.source === 'guasave')!;
    expect(brutal.amount).toBeCloseTo(p.businesses * e.extortionRates.brutal.incomePerBusinessPerDay * c);
  });

  it('labs pay a fixed daily output; rackets scale with size and support', () => {
    const s = empty();
    const bad = lines(s, 'chapitos_head').filter((l) => l.source === 'badiraguato');
    expect(bad.find((l) => l.stream === 'labs')!.amount).toBe(s.nodes.badiraguato!.labs * e.labOutputPerDay);
    const p = s.nodes.badiraguato!;
    expect(bad.find((l) => l.stream === 'rackets')!.amount).toBeCloseTo(p.businesses * e.racketPerBusinessPerDay * (p.support / 100));
  });

  it('a route splits across its nodes: trafficking for the source side, tolls for others, nothing for exits', () => {
    const s = empty();
    const route = calm.routes.find((r) => r.id === 'route_espinazo')!;
    const share = route.dailyValue / route.nodes.length;
    const from = (who: string) => dailyIncome(s, calm).filter((l) => l.recipient === who && l.source === route.id);
    // Source is Mazatlán port (Chapitos): El del Puerto traffics; Mayos-held Villa Unión and Concordia take tolls.
    expect(sum(from('c_mazatlan').filter((l) => l.stream === 'trafficking'))).toBeCloseTo(share * 2);
    expect(from('m_villa_union')).toEqual([expect.objectContaining({ stream: 'tolls', amount: share })]);
    expect(from('m_concordia')).toEqual([expect.objectContaining({ stream: 'tolls', amount: share })]);
  });

  it('each contested node cuts the whole route by 20%', () => {
    const s = empty();
    const route = calm.routes.find((r) => r.id === 'route_espinazo')!;
    s.regions.sur!.combatHoursToday = 1; // every node of this route is in the south
    const share = (route.dailyValue * 0.8 ** route.nodes.length) / route.nodes.length;
    const l = dailyIncome(s, calm).find((x) => x.recipient === 'm_concordia' && x.source === route.id)!;
    expect(l.amount).toBeCloseTo(share);
  });

  it('Culiacán pays by colonia to whoever holds it; contested colonias pay no one', () => {
    const s = empty();
    // Loma de Rodriguera is Chapitos-held (+80) with no crews there: the faction head collects.
    expect(dailyIncome(s, calm).some((l) => l.source === 'col_loma_de_rodriguera' && l.recipient === 'chapitos_head')).toBe(true);
    addCrew(s, 'c', 'c_culiacan_norte', 'culiacan', { colonia: 'col_loma_de_rodriguera' });
    expect(dailyIncome(s, calm).some((l) => l.source === 'col_loma_de_rodriguera' && l.recipient === 'c_culiacan_norte')).toBe(true);
    expect(dailyIncome(s, calm).some((l) => l.source === 'col_centro')).toBe(false);
  });

  it('settlement pays into the plaza stash, and aligned characters tithe 20% to their head', () => {
    let s = empty();
    const before = s.nodes.guasave!.stash;
    const headBefore = cashOf(s, 'mayos_head');
    const earned = sum(lines(s, 'm_guasave'));
    s = runTo(s, 24);
    const guasaveEarned = sum(dailyIncome(empty(), calm).filter((l) => l.recipient === 'm_guasave' && l.node === 'guasave'));
    expect(s.nodes.guasave!.stash).toBeGreaterThan(before + guasaveEarned * 0.5);
    const day = s.characters.m_guasave!.ledger.at(-1)!;
    expect(day.costs.tribute).toBeCloseTo(earned * e.factionTributeRate, 0);
    expect(cashOf(s, 'mayos_head')).toBeGreaterThan(headBefore);
  });

  it('neutrals keep everything', () => {
    let s = empty();
    s = step(s, [{ type: 'declare_alignment', issuer: 'c_mazatlan', faction: null }]);
    s = runTo(s, 24);
    expect(s.characters.c_mazatlan!.ledger.at(-1)!.costs.tribute ?? 0).toBe(0);
  });

  it('income regenerates faction Supply', () => {
    let s = empty();
    s.factions.chapitos!.supply = 10;
    s = runTo(s, 24);
    expect(s.factions.chapitos!.supply).toBeGreaterThan(10);
  });
});

describe('weekly bills', () => {
  it('payroll is due Sunday: men × rate × tier', () => {
    let s = empty();
    addCrew(s, 'x', 'c_mazatlan', 'mazatlan', { men: 10, skill: 2 });
    const due = 10 * e.payrollPerManPerWeek * calm.tuning.forces.payBySkill[1]!;
    expect(payrollDue(s, calm, 'c_mazatlan')).toBe(due);
    s = runTo(s, FIRST_PAYDAY);
    expect(s.characters.c_mazatlan!.ledger.at(-1)!.costs.payroll).toBe(due);
    expect(s.characters.c_mazatlan!.missedPayrollWeeks).toBe(0);
  });

  it('a missed payday costs 20 morale and leader opinion; a second one starts desertions', () => {
    // El Chato holds only Sanalona, which is on no route; strip its income and cash.
    let s = empty('c_sanalona');
    addCrew(s, 'x', 'c_sanalona', 'sanalona', { men: 20, vehicles: { pickup: 5, suv: 0, motorcycle: 0, armored: 0 }, leader: 'cl_el_gato', morale: 70 });
    s.nodes.sanalona!.stash = 0;
    s.nodes.sanalona!.businesses = 0;
    s = runTo(s, FIRST_PAYDAY);
    expect(s.characters.c_sanalona!.missedPayrollWeeks).toBe(1);
    expect(s.crews.x!.morale).toBeLessThanOrEqual(70 - 20 + 1);
    expect(s.characters.cl_el_gato!.opinions.c_sanalona?.[0]?.key).toBe('paid_late');
    expect(s.feed.some((f) => f.text.includes('could not make payroll'))).toBe(true);
    s = runTo(s, FIRST_PAYDAY + 7 * 24);
    expect(s.characters.c_sanalona!.missedPayrollWeeks).toBe(2);
    const men = s.crews.x!.men;
    s = runTo(s, FIRST_PAYDAY + 8 * 24);
    expect(s.crews.x!.men).toBe(men - Math.ceil(men * e.missedPayroll.desertionRatePerDay));
  });

  it('halcones nobody can pay walk away', () => {
    let s = empty();
    for (const n of Object.values(s.nodes)) n.stash = 0;
    // Angostura and La Reforma are on no route: with no businesses they earn nothing.
    s.nodes.angostura!.halconCoverage = 50;
    s.nodes.angostura!.businesses = 0;
    s.nodes.la_reforma!.businesses = 0;
    s = runTo(s, FIRST_PAYDAY);
    expect(s.nodes.angostura!.halconCoverage).toBeLessThan(50);
  });

  it('extortion moves support and closes businesses each week', () => {
    let s = empty();
    s.nodes.guasave!.extortionRate = 'brutal';
    const sup = s.nodes.guasave!.support;
    const biz = s.nodes.guasave!.businesses;
    s = runTo(s, FIRST_PAYDAY);
    expect(s.nodes.guasave!.support).toBe(sup + e.extortionRates.brutal.supportPerWeek);
    expect(s.nodes.guasave!.businesses).toBeCloseTo(biz * (1 - e.extortionRates.brutal.businessClosurePerWeek));
  });

  it('fighting in a plaza closes businesses and angers locals', () => {
    let s = empty();
    s.nodes.guasave!.combatHoursToday = 5;
    const biz = s.nodes.guasave!.businesses;
    const sup = s.nodes.guasave!.support;
    s = runTo(s, 24);
    expect(s.nodes.guasave!.businesses).toBeCloseTo(biz * (1 - 5 * e.businessLossPerCombatHour));
    expect(s.nodes.guasave!.support).toBe(sup - 5 * e.supportLossPerCombatHour);
  });
});

describe('stash houses', () => {
  it('starting cash sits in the home plaza; spending takes the purse, then the biggest stash', () => {
    const s = empty();
    expect(s.nodes.mazatlan!.stash).toBe(900000);
    s.characters.c_mazatlan!.purse = 1000;
    expect(spend(s, calm, 'c_mazatlan', 5000, 'drones')).toBe(true);
    expect(s.characters.c_mazatlan!.purse).toBe(0);
    expect(s.nodes.mazatlan!.stash).toBe(896000);
    expect(spend(s, calm, 'c_mazatlan', 1e9, 'drones')).toBe(false);
  });

  it('cash moves between your own plazas', () => {
    const s = empty();
    expect(moveCash(s, 'c_mazatlan', 'mazatlan', 'la_noria', 100000)).toBeNull();
    expect(s.nodes.la_noria!.stash).toBe(100000);
    expect(moveCash(s, 'c_mazatlan', 'mazatlan', 'villa_union', 1)).toMatch(/your own plazas/);
  });

  it('whoever takes a plaza takes its stash', () => {
    let s = empty();
    s.nodes.villa_union!.stash = 50000;
    const before = cashOf(s, 'c_mazatlan');
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { order: { type: 'idle' } });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }]);
    expect(s.nodes.villa_union!.owner).toBe('c_mazatlan');
    expect(cashOf(s, 'c_mazatlan')).toBeGreaterThanOrEqual(before + 50000 - 1000);
  });
});

describe('spending', () => {
  it('recruits: limited by the pool and seats; they cost money and dilute skill', () => {
    let s = empty();
    addCrew(s, 'x', 'c_mazatlan', 'mazatlan', { men: 8, skill: 5, vehicles: { pickup: 3, suv: 0, motorcycle: 0, armored: 0 } });
    s.nodes.mazatlan!.recruits = 10;
    let r = tick(s, [{ type: 'recruit', issuer: 'c_mazatlan', crew: 'x', men: 5 }], calm);
    expect(r.rejected[0]?.reason).toMatch(/seats/);
    r = tick(s, [{ type: 'recruit', issuer: 'c_mazatlan', crew: 'x', men: 11 }], calm);
    expect(r.rejected[0]?.reason).toMatch(/only 10 men/);
    const cash = cashOf(s, 'c_mazatlan');
    s = step(s, [{ type: 'recruit', issuer: 'c_mazatlan', crew: 'x', men: 4 }]);
    expect(s.crews.x!.men).toBe(12);
    expect(s.crews.x!.skill).toBe(Math.round((5 * 8 + 1 * 4) / 12));
    expect(s.crews.x!.establishment).toBe(12);
    expect(cashOf(s, 'c_mazatlan')).toBeLessThan(cash - 4 * e.recruitment.signingCostPerMan + 1);
  });

  it('raises a new crew with the pickups it needs', () => {
    let s = empty();
    s.nodes.mazatlan!.recruits = 20;
    s = step(s, [{ type: 'form_crew', issuer: 'c_mazatlan', node: 'mazatlan', men: 10, leader: 'cl_el_zurdo' }]);
    const crew = Object.values(s.crews).find((c) => c.owner === 'c_mazatlan')!;
    expect(crew.men).toBe(10);
    expect(crew.vehicles.pickup).toBe(3);
    expect(crew.leader).toBe('cl_el_zurdo');
    expect(crew.skill).toBe(e.recruitment.recruitSkill);
  });

  it('recruit pools refill daily, faster in bigger, friendlier plazas', () => {
    let s = empty();
    s = runTo(s, 24);
    expect(s.nodes.mazatlan!.recruits).toBeGreaterThan(s.nodes.la_noria!.recruits);
    expect(s.nodes.durango_exit!.recruits).toBe(0);
  });

  it('armored trucks are scarce and restock monthly', () => {
    let s = empty();
    addCrew(s, 'x', 'c_mazatlan', 'mazatlan');
    const stock = s.market.armored;
    s = step(s, [{ type: 'buy_vehicles', issuer: 'c_mazatlan', crew: 'x', vehicle: 'armored', count: stock }]);
    expect(s.crews.x!.vehicles.armored).toBe(stock);
    const r = tick(s, [{ type: 'buy_vehicles', issuer: 'c_mazatlan', crew: 'x', vehicle: 'armored', count: 1 }], calm);
    expect(r.rejected[0]?.reason).toMatch(/only 0 armored/);
    s = runTo(s, e.armoredRestockDays * 24 + 1);
    expect(s.market.armored).toBe(1);
  });

  it('the faction head sends aid once per cooldown; neutrals cannot ask', () => {
    let s = empty();
    const before = cashOf(s, 'c_mazatlan');
    s = step(s, [{ type: 'request_aid', issuer: 'c_mazatlan' }]);
    expect(cashOf(s, 'c_mazatlan')).toBe(before + e.aid.maxCash);
    let r = tick(s, [{ type: 'request_aid', issuer: 'c_mazatlan' }], calm);
    expect(r.rejected[0]?.reason).toMatch(/ask again/);
    s = step(s, [{ type: 'declare_alignment', issuer: 'c_la_tuna', faction: null }]);
    r = tick(s, [{ type: 'request_aid', issuer: 'c_la_tuna' }], calm);
    expect(r.rejected[0]?.reason).toMatch(/neutrals/);
  });
});

describe('AI economy', () => {
  it('an AI lieutenant with money recruits a depleted crew back to strength', () => {
    const c = tuned((t) => {
      t.ai.layers = { strategic: false, operational: false, tactical: false, economy: true, traffic: false, events: false, shadow: false, coalition: false, outside: false };
    });
    let s = newGame(c, { seed: 1, playerId: 'c_mazatlan' });
    const crew = Object.values(s.crews).find((x) => x.owner === 'm_guasave')!;
    crew.men = 10;
    s.nodes.guasave!.recruits = 20;
    s.nodes.guasave!.stash = 500000;
    for (let i = 0; i < 26; i++) s = tick(s, [], c).state;
    expect(s.crews[crew.id]!.men).toBe(crew.establishment);
  });

  it('a broke AI squeezes harder and cuts its halcones', () => {
    const c = tuned((t) => {
      t.ai.layers = { strategic: false, operational: false, tactical: false, economy: true, traffic: false, events: false, shadow: false, coalition: false, outside: false };
    });
    let s = newGame(c, { seed: 1, playerId: 'c_mazatlan' });
    s.characters.m_guasave!.missedPayrollWeeks = 1;
    const cov = s.nodes.guasave!.halconCoverage;
    for (let i = 0; i < 26; i++) s = tick(s, [], c).state;
    expect(s.nodes.guasave!.extortionRate).toBe('high');
    expect(s.nodes.guasave!.halconCoverage).toBe(cov - 10);
  });
});
