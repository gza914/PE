import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import { Intel } from '../src/sim/ai/intel';
import { aged, combine } from '../src/sim/estimate';
import { plazaIntel } from '../src/sim/knowledge';
import { cashOf } from '../src/sim/money';
import { opinionBreakdown } from '../src/sim/opinion';
import type { GameState, Report } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { addCrew, calm, empty, noAi, noBreakdowns, noWorld, tuned } from './helpers';

const t = calm.tuning;

function rep(over: Partial<Report>): Report {
  return {
    id: 'rep_a',
    network: 'chapitos',
    crew: 'x',
    owner: 'm_villa_union',
    men: 20,
    low: 10,
    high: 30,
    vehicles: {},
    where: { kind: 'node', node: 'villa_union' },
    roadType: null,
    hour: 100,
    confidence: 'estimated',
    source: 'halcon',
    planted: false,
    ...over,
  };
}

function run(s: GameState, content: Content, hours: number, cmds: Parameters<typeof tick>[1] = []): GameState {
  let first = true;
  for (let h = 0; h < hours && !s.ended; h++) {
    const r = tick(s, first ? cmds : [], content);
    if (first) expect(r.rejected).toEqual([]);
    first = false;
    s = r.state;
  }
  return s;
}

/** No halcones, so only drones and informants see anything. */
function blind(content: Content = calm): GameState {
  const s = empty('c_mazatlan', content);
  for (const n of Object.values(s.nodes)) n.halconCoverage = 0;
  return s;
}

describe('estimates', () => {
  it('several sources narrow the range', () => {
    const r = combine(t, [rep({ id: 'a', low: 10, high: 30, men: 20 }), rep({ id: 'b', low: 18, high: 40, men: 26 })], 100);
    expect(r.low).toBe(18);
    expect(r.high).toBe(30);
    expect(r.men).toBeGreaterThanOrEqual(18);
    expect(r.men).toBeLessThanOrEqual(30);
  });

  it('age widens a range again', () => {
    const fresh = aged(t, rep({}), 100);
    const old = aged(t, rep({}), 148);
    expect(old.low).toBeLessThan(fresh.low);
    expect(old.high).toBeGreaterThan(fresh.high);
    expect(old.men).toBe(fresh.men);
  });

  it('sources that disagree outright: the newest wins', () => {
    const r = combine(t, [rep({ id: 'a', low: 10, high: 14, men: 12, hour: 90 }), rep({ id: 'b', low: 40, high: 50, men: 45, hour: 100 })], 100);
    expect(r.men).toBe(45);
    expect(r.low).toBe(40);
  });

  it('halcón sightings carry a range that holds the truth', () => {
    const c = tuned((x) => {
      noAi(x);
      noWorld(x);
      noBreakdowns(x);
      x.detection.maxChance = 1;
      x.detection.coefficient = 10;
    });
    let s = empty('c_mazatlan', c);
    addCrew(s, 'x', 'm_villa_union', 'mazatlan', { men: 24, order: { type: 'idle' } });
    s = run(s, c, 2);
    const seen = s.reports.filter((r) => r.crew === 'x' && r.network === 'chapitos');
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) {
      expect(r.low).toBeLessThanOrEqual(24);
      expect(r.high).toBeGreaterThanOrEqual(24);
      expect(r.low).toBeLessThan(r.high);
    }
  });
});

describe('drones over towns', () => {
  it('count the street and give a range; cost more than a road drone', () => {
    let s = blind();
    addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: 40 });
    const before = cashOf(s, 'c_mazatlan');
    s = run(s, calm, 2, [{ type: 'launch_drone', issuer: 'c_mazatlan', node: 'villa_union' }]);
    expect(before - cashOf(s, 'c_mazatlan')).toBeGreaterThanOrEqual(t.intel.droneTown.cost);
    const seen = s.reports.filter((r) => r.crew === 'g' && r.source === 'drone');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!.low).toBeLessThan(seen[0]!.high);
    const pi = plazaIntel(s, calm, 'chapitos', 'villa_union', 24);
    expect(pi.crews.map((x) => x.crew)).toEqual(['g']);
    expect(pi.complete).toBe(false);
    expect(pi.sources.drone).toBeGreaterThan(0);
  });

  it('miss men lying low indoors', () => {
    const avg = (lieLow: boolean) => {
      let total = 0;
      for (let seed = 1; seed <= 6; seed++) {
        let s = empty('c_mazatlan', calm, seed);
        for (const n of Object.values(s.nodes)) n.halconCoverage = 0;
        addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: 40, order: lieLow ? { type: 'lie_low', since: 0 } : { type: 'idle' } });
        s = run(s, calm, 4, [{ type: 'launch_drone', issuer: 'c_mazatlan', node: 'villa_union' }]);
        const r = combine(calm.tuning, s.reports.filter((x) => x.crew === 'g'), s.hour);
        total += r.men;
      }
      return total / 6;
    };
    expect(avg(true)).toBeLessThan(avg(false) * 0.6);
  });

  it('cannot cover Culiacán, and need a road or a town', () => {
    const s = blind();
    expect(tick(s, [{ type: 'launch_drone', issuer: 'c_mazatlan', node: 'culiacan' }], calm).rejected[0]!.reason).toMatch(/too big/);
    expect(tick(s, [{ type: 'launch_drone', issuer: 'c_mazatlan' }], calm).rejected[0]!.reason).toMatch(/road or a town/);
  });
});

describe('informants', () => {
  const safe = tuned((x) => {
    noAi(x);
    noWorld(x);
    noBreakdowns(x);
    x.intel.informant.discovery.base = 0;
    x.intel.informant.discovery.max = 0;
  });

  it('settle in, then report the whole garrison as a range', () => {
    let s = blind(safe);
    addCrew(s, 'g1', 'm_villa_union', 'villa_union', { men: 30 });
    addCrew(s, 'g2', 'm_villa_union', 'villa_union', { men: 12, order: { type: 'lie_low', since: 0 } });
    s = run(s, safe, 24, [{ type: 'plant_informant', issuer: 'c_mazatlan', node: 'villa_union' }]);
    expect(s.informants).toHaveLength(1);
    expect(s.reports.filter((r) => r.source === 'informant')).toHaveLength(0);
    s = run(s, safe, safe.tuning.intel.informant.settleDays * 24 + 2);
    const pi = plazaIntel(s, safe, 'chapitos', 'villa_union', 24);
    expect(pi.complete).toBe(true);
    expect(pi.crews.map((x) => x.crew).sort()).toEqual(['g1', 'g2']);
    expect(pi.low).toBeLessThanOrEqual(42);
    expect(pi.high).toBeGreaterThanOrEqual(42);
    expect(s.feed.some((f) => /Informant in Villa Unión: \d+ men at .*Probably/.test(f.text))).toBe(true);
    // The AI's planner reads the same reports: a known garrison with a range.
    const est = new Intel(s, safe).defense('chapitos', 'villa_union');
    expect(est.known).toBe(true);
    expect(est.low).toBeLessThan(est.high);
  });

  it('a caught informant is lost, and the plaza owner knows who sent him', () => {
    const risky = tuned((x) => {
      noAi(x);
      noWorld(x);
      noBreakdowns(x);
      x.intel.informant.discovery.base = 1;
      x.intel.informant.discovery.max = 1;
    });
    let s = blind(risky);
    s = run(s, risky, 25, [{ type: 'plant_informant', issuer: 'c_mazatlan', node: 'villa_union' }]);
    expect(s.informants).toHaveLength(0);
    expect(opinionBreakdown(s, risky, 'm_villa_union', 'c_mazatlan').some((l) => l.key === 'planted_an_informant')).toBe(true);
    expect(s.feed.some((f) => /informant in Villa Unión was found out/.test(f.text))).toBe(true);
  });

  it('only in towns the other side holds, one per side per town', () => {
    let s = blind(safe);
    expect(tick(s, [{ type: 'plant_informant', issuer: 'c_mazatlan', node: 'mazatlan' }], safe).rejected[0]!.reason).toMatch(/already holds/);
    s = run(s, safe, 1, [{ type: 'plant_informant', issuer: 'c_mazatlan', node: 'villa_union' }]);
    expect(tick(s, [{ type: 'plant_informant', issuer: 'c_mazatlan', node: 'villa_union' }], safe).rejected[0]!.reason).toMatch(/already has a man/);
    const id = s.informants[0]!.id;
    s = run(s, safe, 1, [{ type: 'pull_informant', issuer: 'c_mazatlan', informant: id }]);
    expect(s.informants).toHaveLength(0);
  });
});

describe('AI eyes', () => {
  it('plants an informant in its war target when it knows little', () => {
    const c = tuned((x) => {
      noAi(x);
      noWorld(x);
      noBreakdowns(x);
      x.ai.layers.shadow = true;
      x.ai.shadow.informantDailyChance = 1;
      x.ai.shadow.schemeDailyChance = 0;
      x.ai.shadow.rumorDailyChance = 0;
      x.ai.shadow.messageDailyChance = 0;
    });
    let s = blind(c);
    s.factions.chapitos!.warPlan.target = 'villa_union';
    s = run(s, c, 48);
    expect(s.informants.some((i) => i.network === 'chapitos' && i.node === 'villa_union')).toBe(true);
  });
});
