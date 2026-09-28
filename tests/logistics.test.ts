import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import type { Command } from '../src/sim/commands';
import { lastSeen } from '../src/sim/knowledge';
import { cashOf } from '../src/sim/money';
import { newGame } from '../src/sim/newGame';
import { planRoute } from '../src/sim/routing';
import { allowedRoadTypes, detectionChance, groupSpeedKmh, signature } from '../src/sim/signature';
import type { CrewState, GameState } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { world } from '../src/sim/world';

import { addCrew, content as bundled, crewsOf, noAi, noBreakdowns, order, quiet, run, start, tuned as tunedWithAi } from './helpers';

/** Mechanics tests run in a world with the AI switched off. */
const content = quiet();
void bundled;
const tuned = (mut: (t: Content['tuning']) => void) =>
  tunedWithAi((t) => {
    noAi(t);
    mut(t);
  });

describe('signature and detection (GDD table, 80 coverage)', () => {
  const s = start();
  const t = content.tuning;
  const mk = (vehicles: Partial<CrewState['vehicles']>, skill = 3): CrewState =>
    addCrew(structuredClone(s), 'x', 'c_mazatlan', 'mazatlan', {
      skill,
      vehicles: { pickup: 0, suv: 0, motorcycle: 0, armored: 0, ...vehicles },
    });
  const p = (crew: CrewState, road: 'highway' | 'paved' | 'brecha', night: boolean) =>
    detectionChance(signature(s, content, [crew], { visibility: t.roads[road].visibility, night, calentura: 0 }), 80, t);

  // Skill 1–2 crews have stealth 1.0, matching the GDD's plain rows.
  it('50 pickups on a highway by day: capped at 95%', () => expect(p(mk({ pickup: 50 }, 1), 'highway', false)).toBeCloseTo(0.95));
  it('1 armored truck on a highway by day: 38%', () => expect(p(mk({ armored: 1 }, 1), 'highway', false)).toBeCloseTo(0.384));
  it('10 pickups on paved at night: 23%', () => expect(p(mk({ pickup: 10 }, 1), 'paved', true)).toBeCloseTo(0.2304));
  it('3 pickups, elite crew, brecha at night: 2% floor', () => expect(p(mk({ pickup: 3 }, 5), 'brecha', true)).toBeCloseTo(0.02));
  it('a crew lying low is never seen', () => {
    const c = mk({ pickup: 3 });
    c.order = { type: 'lie_low' };
    expect(p(c, 'highway', false)).toBe(0);
  });
});

describe('vehicles and speed', () => {
  it('armored trucks and SUVs keep a group off brechas', () => {
    const s = start();
    const [heavy] = crewsOf(s, 'c_mazatlan').filter((c) => c.vehicles.armored > 0);
    expect(allowedRoadTypes([heavy!], content.tuning).has('brecha')).toBe(false);
    const light = addCrew(s, 'light', 'c_mazatlan', 'mazatlan');
    expect(allowedRoadTypes([light], content.tuning).has('brecha')).toBe(true);
  });

  it('the slowest vehicle sets the pace', () => {
    const s = start();
    const light = addCrew(s, 'light', 'c_mazatlan', 'mazatlan');
    const heavy = addCrew(s, 'heavy', 'c_mazatlan', 'mazatlan', { vehicles: { pickup: 2, suv: 0, motorcycle: 0, armored: 1 } });
    expect(groupSpeedKmh([light, heavy], 'highway', content.tuning)).toBe(content.tuning.vehicles.armored.baseSpeedKmh);
  });
});

describe('route planning', () => {
  it('fastest Mazatlán → Culiacán takes the highway in about 3 hours', () => {
    const s = start();
    const crew = addCrew(s, 'x', 'c_mazatlan', 'mazatlan');
    const r = planRoute(s, content, { crews: [crew], from: crew.location, destination: 'culiacan', preference: 'fastest', departHour: 10, viewer: 'chapitos' })!;
    expect(r.path.map((p) => world(content).road(p.road).type)).toEqual(['highway', 'highway']);
    expect(r.hours).toBeGreaterThan(2.5);
    expect(r.hours).toBeLessThan(3.5);
  });

  it('safest trades time for lower estimated risk', () => {
    const s = start();
    const crew = addCrew(s, 'x', 'c_mazatlan', 'mazatlan', { vehicles: { pickup: 8, suv: 0, motorcycle: 0, armored: 0 }, men: 30 });
    const req = { crews: [crew], from: crew.location, destination: 'culiacan', departHour: 10, viewer: 'chapitos' };
    const fast = planRoute(s, content, { ...req, preference: 'fastest' })!;
    const safe = planRoute(s, content, { ...req, preference: 'safest' })!;
    expect(safe.hours).toBeGreaterThan(fast.hours);
    expect(safe.expectedDetections).toBeLessThan(fast.expectedDetections);
  });

  it('never routes an armored group down a brecha', () => {
    const s = start();
    const crew = addCrew(s, 'x', 'c_la_tuna', 'la_tuna', { vehicles: { pickup: 2, suv: 0, motorcycle: 0, armored: 1 } });
    const r = planRoute(s, content, { crews: [crew], from: crew.location, destination: 'cosala', preference: 'safest', departHour: 0, viewer: 'chapitos' });
    expect(r).not.toBeNull();
    for (const step of r!.path) expect(world(content).road(step.road).type).not.toBe('brecha');
  });

  it('honors waypoints', () => {
    const s = start();
    const crew = addCrew(s, 'x', 'c_mazatlan', 'mazatlan');
    const r = planRoute(s, content, { crews: [crew], from: crew.location, destination: 'culiacan', waypoints: ['cosala'], preference: 'fastest', departHour: 0, viewer: 'chapitos' })!;
    expect(r.path.some((p) => p.to === 'cosala')).toBe(true);
  });

  it('plans from the middle of a road, reversing if that is shorter', () => {
    const s = start();
    const road = content.roads.find((r) => r.id === 'r_la_cruz_to_mazatlan')!;
    const crew = addCrew(s, 'x', 'c_mazatlan', 'mazatlan', {
      location: { kind: 'road', road: road.id, from: 'mazatlan', to: 'la_cruz', progressKm: 10 },
    });
    const r = planRoute(s, content, { crews: [crew], from: crew.location, destination: 'mazatlan', preference: 'fastest', departHour: 0, viewer: 'chapitos' })!;
    expect(r.path).toEqual([{ road: road.id, to: 'mazatlan' }]);
    expect(r.km).toBeCloseTo(10);
  });
});

describe('movement', () => {
  it('drives a planned route and garrisons on arrival at a friendly plaza', () => {
    const c = tuned(noBreakdowns);
    let s = newGame(c, { seed: 3, playerId: 'c_mazatlan' });
    const crew = addCrew(s, 'x', 'c_mazatlan', 'mazatlan');
    s = order(s, crew, { type: 'move', destination: 'la_noria', preference: 'fastest' }, c);
    expect(s.crews.x!.location.kind).toBe('node');
    expect((s.crews.x!.location as { node: string }).node).toBe('la_noria');
    expect(s.crews.x!.order.type).toBe('garrison');
  });

  it('takes multiple hours on long roads and ends idle in a plaza it does not hold', () => {
    const c = tuned(noBreakdowns);
    let s = newGame(c, { seed: 3, playerId: 'c_mazatlan' });
    const crew = addCrew(s, 'x', 'c_mazatlan', 'mazatlan');
    s = order(s, crew, { type: 'move', destination: 'culiacan', preference: 'fastest' }, c);
    expect(s.crews.x!.location.kind).toBe('road');
    s = run(s, 3, c);
    expect(s.crews.x!.location).toEqual({ kind: 'node', node: 'culiacan' });
    expect(s.crews.x!.order.type).toBe('idle');
    expect(s.crews.x!.fatigue).toBeGreaterThan(0);
  });

  it('sync arrival: crews from different distances arrive in the same hour', () => {
    const c = tuned(noBreakdowns);
    let s = newGame(c, { seed: 5, playerId: 'c_mazatlan' });
    const near = addCrew(s, 'near', 'c_mazatlan', 'la_noria');
    const far = addCrew(s, 'far', 'c_mazatlan', 'san_ignacio', { owner: 'c_mazatlan' });
    const arriveAt = 20;
    const cmds: Command[] = [near, far].map((cr) => ({
      type: 'order_crew',
      issuer: 'c_mazatlan',
      crew: cr.id,
      order: { type: 'move', destination: 'mazatlan', preference: 'fastest', arriveAt },
    }));
    const r = tick(s, cmds, c);
    expect(r.rejected).toEqual([]);
    s = r.state;
    const arrivals: Record<string, number> = {};
    for (let h = 0; h < 30; h++) {
      s = tick(s, [], c).state;
      for (const id of ['near', 'far']) {
        const loc = s.crews[id]!.location;
        if (!(id in arrivals) && loc.kind === 'node' && loc.node === 'mazatlan') arrivals[id] = s.hour;
      }
    }
    expect(arrivals.near).toBeDefined();
    expect(Math.abs(arrivals.near! - arriveAt)).toBeLessThanOrEqual(1);
    expect(Math.abs(arrivals.far! - arriveAt)).toBeLessThanOrEqual(1);
  });

  it('brechas can break down', () => {
    const c = tuned((t) => {
      t.roads.brecha.breakdownChancePerSegment = 1;
    });
    let s = newGame(c, { seed: 1, playerId: 'c_la_tuna' });
    const crew = addCrew(s, 'x', 'c_la_tuna', 'la_tuna');
    s = order(s, crew, { type: 'move', destination: 'tameapa', preference: 'fastest' }, c);
    expect(s.crews.x!.transit.waitUntil).toBe(s.hour + c.tuning.movement.breakdownDelayHours);
  });

  it('retreat heads for the nearest friendly plaza', () => {
    let s = start();
    const crew = addCrew(s, 'x', 'c_mazatlan', 'villa_union');
    s = order(s, crew, { type: 'retreat' });
    // 25 km of highway: it is home within the hour.
    expect(s.crews.x!.location).toEqual({ kind: 'node', node: 'mazatlan' });
    expect(s.crews.x!.order.type).toBe('garrison');
  });

  it('rejects orders the vehicles cannot follow', () => {
    const s = start();
    const crew = addCrew(s, 'x', 'c_la_tuna', 'tameapa', { vehicles: { pickup: 2, suv: 0, motorcycle: 0, armored: 1 } });
    const r = tick(s, [{ type: 'order_crew', issuer: 'c_la_tuna', crew: crew.id, order: { type: 'move', destination: 'la_tuna', preference: 'fastest' } }], content);
    expect(r.rejected[0]?.reason).toMatch(/no route/);
  });
});

describe('split, merge, escort', () => {
  it('splits a crew, respecting seats and minimum size', () => {
    const s = start();
    const crew = addCrew(s, 'x', 'c_mazatlan', 'mazatlan', { men: 20, vehicles: { pickup: 5, suv: 0, motorcycle: 0, armored: 0 } });
    const bad = tick(s, [{ type: 'split_crew', issuer: 'c_mazatlan', crew: crew.id, men: 12, vehicles: { pickup: 2 } }], content);
    expect(bad.rejected[0]?.reason).toMatch(/seats/);
    const ok = tick(s, [{ type: 'split_crew', issuer: 'c_mazatlan', crew: crew.id, men: 8, vehicles: { pickup: 2 } }], content);
    expect(ok.rejected).toEqual([]);
    expect(ok.state.crews.x!.men).toBe(12);
    expect(Object.keys(ok.state.crews).length).toBe(Object.keys(s.crews).length + 1);
  });

  it('merges crews in the same node', () => {
    const s = start();
    addCrew(s, 'a', 'c_mazatlan', 'mazatlan', { men: 10, skill: 5 });
    addCrew(s, 'b', 'c_mazatlan', 'mazatlan', { men: 10, skill: 1 });
    const r = tick(s, [{ type: 'merge_crews', issuer: 'c_mazatlan', crew: 'a', into: 'b' }], content);
    expect(r.rejected).toEqual([]);
    expect(r.state.crews.a).toBeUndefined();
    expect(r.state.crews.b!.men).toBe(20);
    expect(r.state.crews.b!.skill).toBe(3);
    expect(r.state.crews.b!.vehicles.pickup).toBe(6);
  });

  it('an escort moves with its crew and slows it down', () => {
    const c = tuned(noBreakdowns);
    let s = newGame(c, { seed: 2, playerId: 'c_mazatlan' });
    addCrew(s, 'truck', 'c_mazatlan', 'mazatlan', { men: 6, vehicles: { pickup: 0, suv: 0, motorcycle: 0, armored: 1 } });
    addCrew(s, 'main', 'c_mazatlan', 'mazatlan');
    let r = tick(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'truck', order: { type: 'escort', crew: 'main' } }], c);
    expect(r.rejected).toEqual([]);
    s = order(r.state, r.state.crews.main!, { type: 'move', destination: 'la_cruz', preference: 'fastest' }, c);
    expect(s.crews.truck!.location).toEqual(s.crews.main!.location);
    const loc = s.crews.main!.location as { progressKm: number };
    expect(loc.progressKm).toBeCloseTo(c.tuning.vehicles.armored.baseSpeedKmh);
    r = tick(s, [], c);
    expect(r.state.crews.truck!.location).toEqual(r.state.crews.main!.location);
  });
});

describe('detection', () => {
  const certain = (t: Content['tuning']) => {
    noBreakdowns(t);
    t.detection.maxChance = 1;
    t.detection.coefficient = 10;
  };

  it('a convoy passing a hostile plaza is reported to that network, with an estimate', () => {
    const c = tuned(certain);
    let s = newGame(c, { seed: 9, playerId: 'm_la_cruz' });
    const crew = addCrew(s, 'x', 'c_mazatlan', 'mazatlan');
    s = order(s, crew, { type: 'move', destination: 'culiacan', preference: 'fastest' }, c);
    s = run(s, 3, c);
    const seen = lastSeen(s, c, 'mayos').filter((r) => r.crew === 'x');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!.confidence).toBe('estimated');
    expect(s.feed.some((f) => f.audience === 'mayos' && f.text.includes('Halcones'))).toBe(true);
    // The Chapitos network never files reports on its own crew.
    expect(lastSeen(s, c, 'chapitos').some((r) => r.crew === 'x')).toBe(false);
  });

  it('a crew lying low in a hostile node is not seen', () => {
    const c = tuned(certain);
    let s = newGame(c, { seed: 9, playerId: 'm_la_cruz' });
    addCrew(s, 'x', 'c_mazatlan', 'la_cruz', { order: { type: 'lie_low' } });
    s = run(s, 48, c);
    expect(lastSeen(s, c, 'mayos').some((r) => r.crew === 'x')).toBe(false);
  });

  it('a crew sitting in a hostile node is spotted by stationary rolls', () => {
    const c = tuned(certain);
    let s = newGame(c, { seed: 9, playerId: 'm_la_cruz' });
    addCrew(s, 'x', 'c_mazatlan', 'la_cruz', { order: { type: 'idle' } });
    s = run(s, 2, c);
    expect(lastSeen(s, c, 'mayos').some((r) => r.crew === 'x')).toBe(true);
  });

  it('last-seen markers fade after the fade window', () => {
    const c = tuned(certain);
    let s = newGame(c, { seed: 9, playerId: 'm_la_cruz' });
    addCrew(s, 'x', 'c_mazatlan', 'la_cruz', { order: { type: 'idle' } });
    s = run(s, 2, c);
    s.crews.x!.order = { type: 'lie_low' };
    s = run(s, c.tuning.detection.lastSeenFadeHours + 1, c);
    expect(lastSeen(s, c, 'mayos').some((r) => r.crew === 'x')).toBe(false);
  });

  it('a patrol spots crews on its road', () => {
    const c = tuned(certain);
    let s = newGame(c, { seed: 4, playerId: 'm_la_cruz' });
    const patrol = addCrew(s, 'p', 'm_la_cruz', 'la_cruz');
    s = order(s, patrol, { type: 'patrol', road: 'r_la_cruz_to_mazatlan' }, c);
    s = run(s, 2, c);
    // An enemy crew parked on the same road, away from any halcón zone.
    addCrew(s, 'x', 'c_mazatlan', 'mazatlan', {
      order: { type: 'idle' },
      location: { kind: 'road', road: 'r_la_cruz_to_mazatlan', from: 'mazatlan', to: 'la_cruz', progressKm: 40 },
    });
    s = run(s, 1, c);
    const r = lastSeen(s, c, 'mayos').find((x) => x.crew === 'x');
    expect(r?.source).toBe('patrol');
    expect(r?.confidence).toBe('confirmed');
  });

  it('drones reveal a road; a Paranoico leader who notices pulls off it', () => {
    const c = tuned((t) => {
      noBreakdowns(t);
      t.detection.droneNoticeAlertnessFactor = 1;
    });
    let s = newGame(c, { seed: 4, playerId: 'm_la_cruz' });
    // El Tecolote is Paranoico.
    addCrew(s, 'x', 'c_tameapa', 'mazatlan', {
      alertness: 100,
      order: { type: 'idle' },
      location: { kind: 'road', road: 'r_la_cruz_to_mazatlan', from: 'mazatlan', to: 'la_cruz', progressKm: 40 },
    });
    const r = tick(s, [{ type: 'launch_drone', issuer: 'm_la_cruz', road: 'r_la_cruz_to_mazatlan' }], c);
    expect(r.rejected).toEqual([]);
    s = r.state;
    const seen = lastSeen(s, c, 'mayos').find((x) => x.crew === 'x');
    expect(seen?.source).toBe('drone');
    expect(seen?.men).toBe(12);
    const o = s.crews.x!.order;
    expect(o.type === 'move' && o.destination).toBe('mazatlan');
    expect(cashOf(s, 'm_la_cruz')).toBe(content.characters.find((ch) => ch.id === 'm_la_cruz')!.cash - c.tuning.detection.droneCost);
  });

  it('a Sanguinario leader who spots a drone digs in to ambush', () => {
    const c = tuned((t) => {
      t.detection.droneNoticeAlertnessFactor = 1;
    });
    let s = newGame(c, { seed: 4, playerId: 'c_mazatlan' });
    // El Tractor is Sanguinario.
    addCrew(s, 'x', 'm_costa_rica', 'la_cruz', {
      alertness: 100,
      order: { type: 'idle' },
      location: { kind: 'road', road: 'r_la_cruz_to_mazatlan', from: 'la_cruz', to: 'mazatlan', progressKm: 30 },
    });
    s = tick(s, [{ type: 'launch_drone', issuer: 'c_mazatlan', road: 'r_la_cruz_to_mazatlan' }], c).state;
    expect(s.crews.x!.order.type).toBe('ambush');
  });
});

describe('balance targets (GDD "Convoy trade-off")', () => {
  const c = tuned(noBreakdowns);
  const trials = 300;

  it('a 50-truck highway convoy is detected on over 90% of trips', () => {
    let detected = 0;
    for (let seed = 1; seed <= trials; seed++) {
      let s = newGame(c, { seed, playerId: 'm_la_cruz' });
      s.hour = 9; // daytime
      const crew = addCrew(s, 'convoy', 'c_mazatlan', 'mazatlan', { men: 40, skill: 2, vehicles: { pickup: 50, suv: 0, motorcycle: 0, armored: 0 } });
      s = order(s, crew, { type: 'move', destination: 'culiacan', preference: 'fastest' }, c);
      s = run(s, 4, c);
      if (s.reports.some((r) => r.crew === 'convoy')) detected++;
    }
    expect(detected / trials).toBeGreaterThan(0.9);
  }, 30000);

  it('a small elite crew on brechas at night is detected on under 15% of trips', () => {
    let detected = 0;
    for (let seed = 1; seed <= trials; seed++) {
      let s = newGame(c, { seed, playerId: 'm_navolato' });
      s.hour = 21; // night
      // La Reforma → Altata → Eldorado is all brecha through Mayos plazas.
      s.nodes.la_reforma!.halconCoverage = 80;
      s.nodes.altata!.halconCoverage = 80;
      s.nodes.eldorado!.halconCoverage = 80;
      const crew = addCrew(s, 'elite', 'chapitos_head', 'la_reforma', { leader: 'cl_el_gato', men: 12, skill: 5, order: { type: 'idle' } });
      s = order(s, crew, { type: 'move', destination: 'eldorado', preference: 'safest', waypoints: ['altata'] }, c);
      s = run(s, 8, c);
      if (s.reports.some((r) => r.crew === 'elite' && r.source === 'halcon')) detected++;
    }
    expect(detected / trials).toBeLessThan(0.15);
  }, 30000);
});

describe('AI traffic', () => {
  it('AI crews move and rival halcones report them; the AI never commands the player', () => {
    const c = tunedWithAi((t) => {
      t.ai.layers = { strategic: false, operational: false, tactical: false, economy: false, traffic: true };
    });
    let s = newGame(c, { seed: 11, playerId: 'c_mazatlan' });
    const startLocs = new Map(Object.values(s.crews).map((x) => [x.id, JSON.stringify(x.location)]));
    const moved = new Set<string>();
    for (let h = 0; h < 24 * 4; h++) {
      s = tick(s, [], c).state;
      for (const x of Object.values(s.crews)) if (JSON.stringify(x.location) !== startLocs.get(x.id)) moved.add(x.id);
    }
    expect(moved.size).toBeGreaterThan(5);
    expect(s.reports.length).toBeGreaterThan(0);
    for (const x of crewsOf(s, 'c_mazatlan')) expect(moved.has(x.id)).toBe(false);
  });
});
