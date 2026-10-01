import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import type { Command } from '../src/sim/commands';
import { newContext } from '../src/sim/context';
import { crewPayPerWeek, tierLabel, trainingCostPerDay, weaponsCost } from '../src/sim/forces';
import { cashOf } from '../src/sim/money';
import type { GameState } from '../src/sim/state';
import { payrollDue } from '../src/sim/systems/economy';
import { tick } from '../src/sim/tick';
import { addCrew, calm, empty, noAi, noBreakdowns, noWorld, tuned } from './helpers';

const t = calm.tuning;
const f = t.forces;

function step(s: GameState, cmds: Command[] = [], c: Content = calm): GameState {
  const r = tick(s, cmds, c);
  expect(r.rejected).toEqual([]);
  return r.state;
}
const reject = (s: GameState, cmd: Command, c: Content = calm) => tick(s, [cmd], c).rejected[0]?.reason ?? null;
function run(s: GameState, hours: number, c: Content = calm): GameState {
  for (let h = 0; h < hours; h++) s = tick(s, [], c).state;
  return s;
}

describe('crews and columns', () => {
  it('a crew holds up to 50 men', () => {
    const s = empty();
    s.nodes.mazatlan!.recruits = 80;
    s.characters.c_mazatlan!.purse = 1e6;
    expect(reject(s, { type: 'form_crew', issuer: 'c_mazatlan', node: 'mazatlan', men: 50 })).toBeNull();
    expect(reject(s, { type: 'form_crew', issuer: 'c_mazatlan', node: 'mazatlan', men: 51 })).toMatch(/4–50/);
  });

  it('a column is two crews', () => {
    const s = empty();
    addCrew(s, 'a', 'c_mazatlan', 'mazatlan', { men: 40, vehicles: { pickup: 10, suv: 0, motorcycle: 0, armored: 0 } });
    addCrew(s, 'b', 'c_mazatlan', 'mazatlan', { men: 40, order: { type: 'escort', crew: 'a' } });
    addCrew(s, 'c', 'c_mazatlan', 'mazatlan', { men: 10 });
    expect(reject(s, { type: 'order_crew', issuer: 'c_mazatlan', crew: 'c', order: { type: 'escort', crew: 'a' } })).toMatch(/at most 2 crews/);
  });

  it('tiers have names', () => {
    expect(tierLabel(t, { skill: 1, gear: 3 })).toBe(`${f.skillNames[0]} · ${f.gearNames[2]}`);
  });
});

describe('pay by tier', () => {
  it('better men cost more; mercenaries cost more again', () => {
    const s = empty();
    const a = addCrew(s, 'a', 'c_mazatlan', 'mazatlan', { men: 10, skill: 1 });
    const b = addCrew(s, 'b', 'c_mazatlan', 'mazatlan', { men: 10, skill: 4 });
    expect(crewPayPerWeek(t, b)).toBeGreaterThan(crewPayPerWeek(t, a));
    b.hired = { kind: 'mercenary', from: null, loyalty: 100, payMultiplier: 2 };
    expect(crewPayPerWeek(t, b)).toBe(10 * t.economy.payrollPerManPerWeek * f.payBySkill[3]! * 2);
    expect(payrollDue(s, calm, 'c_mazatlan')).toBe(crewPayPerWeek(t, a) + crewPayPerWeek(t, b));
  });
});

describe('weapons', () => {
  it('upgrading pays the difference per man, only in your plaza', () => {
    let s = empty();
    addCrew(s, 'a', 'c_mazatlan', 'mazatlan', { men: 10, gear: 2 });
    addCrew(s, 'away', 'c_mazatlan', 'villa_union', { men: 10, gear: 2 });
    const before = cashOf(s, 'c_mazatlan');
    const cost = weaponsCost(t, { men: 10, gear: 2 }, 4);
    expect(cost).toBe(10 * (f.weapons.costPerManByGear[3]! - f.weapons.costPerManByGear[1]!));
    expect(reject(s, { type: 'buy_weapons', issuer: 'c_mazatlan', crew: 'away', gear: 4 })).toMatch(/plaza you hold/);
    s = step(s, [{ type: 'buy_weapons', issuer: 'c_mazatlan', crew: 'a', gear: 4 }]);
    expect(s.crews.a!.gear).toBe(4);
    expect(before - cashOf(s, 'c_mazatlan')).toBeGreaterThanOrEqual(cost);
    expect(reject(s, { type: 'buy_weapons', issuer: 'c_mazatlan', crew: 'a', gear: 3 })).toMatch(/already carry/);
  });
});

describe('training camps', () => {
  it('cost money each day, raise calentura, and teach', () => {
    let s = empty();
    s.characters.c_mazatlan!.purse = 1e6;
    addCrew(s, 'a', 'c_mazatlan', 'mazatlan', { men: 10, skill: 1 });
    const heat = s.regions.sur!.calentura;
    s = step(s, [{ type: 'train_crew', issuer: 'c_mazatlan', crew: 'a' }]);
    expect(s.crews.a!.training).not.toBeNull();
    s = run(s, f.training.daysPerLevel[0]! * 24 + 2);
    expect(s.crews.a!.skill).toBe(2);
    expect(s.characters.c_mazatlan!.ledger.reduce((n, d) => n + (d.costs.training ?? 0), 0)).toBeGreaterThan(0);
    expect(s.regions.sur!.calentura).not.toBe(heat);
  });

  it('stop when the crew leaves, and are cheaper in the sierra', () => {
    let s = empty();
    addCrew(s, 'a', 'c_mazatlan', 'mazatlan', { men: 10, skill: 1 });
    s = step(s, [{ type: 'train_crew', issuer: 'c_mazatlan', crew: 'a' }]);
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'a', order: { type: 'move', destination: 'villa_union', preference: 'fastest' } }]);
    s = run(s, 30);
    expect(s.crews.a!.training).toBeNull();
    const g = empty('c_la_tuna');
    const sierra = addCrew(g, 's', 'c_la_tuna', 'la_tuna', { men: 10 });
    const coast = addCrew(g, 'k', 'c_mazatlan', 'mazatlan', { men: 10 });
    const ctx = newContext(g, calm);
    expect(trainingCostPerDay(ctx, sierra, 'la_tuna')).toBeLessThan(trainingCostPerDay(ctx, coast, 'mazatlan'));
  });

  it('go no further than the cap', () => {
    const s = empty();
    addCrew(s, 'a', 'c_mazatlan', 'mazatlan', { men: 10, skill: f.training.maxSkill });
    expect(reject(s, { type: 'train_crew', issuer: 'c_mazatlan', crew: 'a' })).toMatch(/battles do the rest/);
  });
});

describe('veterans and mercenaries', () => {
  it('veterans raise skill at once and are few', () => {
    let s = empty();
    s.characters.c_mazatlan!.purse = 1e6;
    addCrew(s, 'a', 'c_mazatlan', 'mazatlan', { men: 10, skill: 1, vehicles: { pickup: 6, suv: 0, motorcycle: 0, armored: 0 } });
    const pool = s.market.veterans;
    expect(reject(s, { type: 'hire_veterans', issuer: 'c_mazatlan', crew: 'a', men: pool + 1 })).toMatch(/looking for work/);
    s = step(s, [{ type: 'hire_veterans', issuer: 'c_mazatlan', crew: 'a', men: 10 }]);
    expect(s.crews.a!.men).toBe(20);
    expect(s.crews.a!.skill).toBeGreaterThan(1);
    expect(s.market.veterans).toBe(pool - 10);
  });

  it('mercenaries arrive as their own crew and walk when unpaid', () => {
    let s = empty('c_sanalona');
    s.characters.c_sanalona!.purse = 1e6;
    s = step(s, [{ type: 'hire_mercenaries', issuer: 'c_sanalona', node: 'sanalona', men: 12 }]);
    const merc = Object.values(s.crews).find((c) => c.hired?.kind === 'mercenary')!;
    expect(merc.men).toBe(12);
    expect(merc.skill).toBe(f.mercenaries.skill);
    // Broke on payday.
    s.characters.c_sanalona!.purse = 0;
    s.nodes.sanalona!.stash = 0;
    s.nodes.sanalona!.businesses = 0;
    for (const n of Object.values(s.nodes)) if (n.owner === 'c_sanalona') n.stash = 0;
    s = run(s, 7 * 24);
    expect(s.crews[merc.id]).toBeUndefined();
    expect(s.feed.some((e) => /mercenaries packed up and left/.test(e.text))).toBe(true);
  });
});

describe('AI forces', () => {
  it('arms its men and opens a camp when it has the money', () => {
    const c = tuned((x) => {
      noAi(x);
      noWorld(x);
      noBreakdowns(x);
      x.ai.layers.economy = true;
    });
    let s = empty('c_mazatlan', c);
    addCrew(s, 'g', 'c_san_ignacio', 'san_ignacio', { men: 10, gear: 1, skill: 1 });
    s.characters.c_san_ignacio!.purse = 1e6;
    s = run(s, 30, c);
    expect(s.crews.g!.gear).toBe(c.tuning.ai.forces.weaponsTargetGear);
    expect(s.crews.g!.training).not.toBeNull();
  });
});
