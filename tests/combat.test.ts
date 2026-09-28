import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import type { Command } from '../src/sim/commands';
import { newContext } from '../src/sim/context';
import { kmFromRoadStart } from '../src/sim/crews';
import { newGame } from '../src/sim/newGame';
import { cashOf } from '../src/sim/money';
import { crewPower } from '../src/sim/power';
import type { Battle, GameState } from '../src/sim/state';
import { killCharacter } from '../src/sim/systems/characters';
import { tick } from '../src/sim/tick';
import { addCrew, calm, certain, empty, noAi, noBreakdowns, tuned } from './helpers';

function step(s: GameState, cmds: Command[] = [], c: Content = calm) {
  const r = tick(s, cmds, c);
  expect(r.rejected).toEqual([]);
  return r.state;
}

function runUntil(s: GameState, done: (s: GameState) => boolean, max = 200, c: Content = calm): GameState {
  for (let i = 0; i < max && !done(s); i++) s = tick(s, [], c).state;
  return s;
}

const battles = (s: GameState): Battle[] => Object.values(s.battles).sort((a, b) => (a.id < b.id ? -1 : 1));
const active = (s: GameState) => battles(s).filter((b) => b.endedAt === null);
const pickups = (n: number) => ({ pickup: n, suv: 0, motorcycle: 0, armored: 0 });

describe('crew power (GDD formula)', () => {
  const s = empty();
  it('men × skill × gear × morale factors', () => {
    // El del Puerto has Violencia 10, so no leader bonus.
    const c = addCrew(s, 'x', 'c_mazatlan', 'mazatlan', { men: 10, skill: 3, gear: 3, morale: 100 });
    expect(crewPower(s, calm, c)).toBeCloseTo(10 * 1.2 * 1.2 * 1.0);
    c.morale = 50;
    expect(crewPower(s, calm, c)).toBeCloseTo(10 * 1.2 * 1.2 * 0.75);
  });
  it('an armored truck adds 30', () => {
    const c = addCrew(s, 'y', 'c_mazatlan', 'mazatlan', { men: 10, morale: 100, vehicles: { pickup: 1, suv: 0, motorcycle: 0, armored: 1 } });
    expect(crewPower(s, calm, c)).toBeCloseTo(14.4 + 30);
  });
  it('a violent leader hits harder', () => {
    const c = addCrew(s, 'z', 'c_la_tuna', 'la_tuna', { men: 10, morale: 100 });
    expect(crewPower(s, calm, c)).toBeCloseTo(14.4 * (1 + 3 * calm.tuning.combat.violenciaBonusPerPoint));
  });
});

describe('road engagements', () => {
  const road = 'r_la_cruz_to_mazatlan'; // la_cruz → mazatlan, 100 km highway

  it('an unseen ambush stops a passing group and strikes first at 2.5×', () => {
    let s = empty();
    addCrew(s, 'amb', 'm_la_cruz', 'la_cruz', {
      men: 12,
      order: { type: 'ambush', road, atKm: 50 },
      location: { kind: 'road', road, from: 'la_cruz', to: 'mazatlan', progressKm: 50 },
    });
    addCrew(s, 'vic', 'c_mazatlan', 'mazatlan', { alertness: 0, order: { type: 'idle' } });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'vic', order: { type: 'move', destination: 'la_cruz', preference: 'fastest' } }]);
    const b = battles(s)[0]!;
    expect(b.type).toBe('ambush');
    expect(b.attackers.crews).toContain('amb');
    expect(b.defenders.crews).toContain('vic');
    const loc = s.crews.vic?.location;
    if (loc?.kind === 'road') expect(kmFromRoadStart(calm, loc)).toBeCloseTo(50);
    // First resolved hour: ambushers at 2.5× on open valley (terrain 1.0).
    expect(b.hours).toBe(1);
    const expected = crewPower(s, calm, { ...s.crews.amb!, men: 12, morale: 70 }) * 2.5;
    expect(b.attackers.power).toBeGreaterThan(expected * 0.9);
  });

  it('an alert crew can spot the ambush; then only a willing side fights', () => {
    const c = tuned((t) => {
      noBreakdowns(t);
      noAi(t);
      t.combat.ambushSpotAlertnessFactor = 1;
    });
    let s = empty('c_mazatlan', c);
    addCrew(s, 'amb', 'm_la_cruz', 'la_cruz', {
      men: 6,
      order: { type: 'ambush', road, atKm: 50 },
      location: { kind: 'road', road, from: 'la_cruz', to: 'mazatlan', progressKm: 50 },
    });
    addCrew(s, 'vic', 'c_mazatlan', 'mazatlan', { men: 30, alertness: 100, vehicles: pickups(8), order: { type: 'idle' } });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'vic', order: { type: 'move', destination: 'la_cruz', preference: 'fastest' } }], c);
    const b = battles(s)[0]!;
    expect(b.type).toBe('road_clash');
    expect(b.attackers.crews).toContain('vic');
  });

  it('opposing groups meeting on a road clash when one side is clearly stronger', () => {
    let s = empty();
    addCrew(s, 'big', 'c_mazatlan', 'mazatlan', { men: 30, vehicles: pickups(8), order: { type: 'idle' } });
    addCrew(s, 'small', 'm_la_cruz', 'la_cruz', { men: 8, vehicles: pickups(2), order: { type: 'idle' } });
    s = step(s, [
      { type: 'order_crew', issuer: 'c_mazatlan', crew: 'big', order: { type: 'move', destination: 'la_cruz', preference: 'fastest' } },
      { type: 'order_crew', issuer: 'm_la_cruz', crew: 'small', order: { type: 'move', destination: 'mazatlan', preference: 'fastest' } },
    ]);
    const b = battles(s)[0]!;
    expect(b.type).toBe('road_clash');
    expect(b.attackers.crews).toEqual(['big']);
  });

  it('evenly matched groups that neither wants to fight pass each other', () => {
    let s = empty();
    addCrew(s, 'a', 'c_mazatlan', 'mazatlan', { order: { type: 'idle' } });
    addCrew(s, 'b', 'm_la_cruz', 'la_cruz', { order: { type: 'idle' } });
    s = step(s, [
      { type: 'order_crew', issuer: 'c_mazatlan', crew: 'a', order: { type: 'move', destination: 'la_cruz', preference: 'fastest' } },
      { type: 'order_crew', issuer: 'm_la_cruz', crew: 'b', order: { type: 'move', destination: 'mazatlan', preference: 'fastest' } },
    ]);
    s = runUntil(s, (x) => x.crews.a!.location.kind === 'node');
    expect(battles(s)).toEqual([]);
  });
});

describe('raids, sieges, and plaza capture', () => {
  it('an unopposed raid takes the plaza', () => {
    let s = empty();
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { order: { type: 'idle' } });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }]);
    expect(s.nodes.villa_union!.owner).toBe('c_mazatlan');
    expect(s.nodes.villa_union!.halconCoverage).toBe(calm.tuning.combat.capturedPlazaHalcones);
    expect(s.crews.r!.order.type).toBe('garrison');
  });

  it('a strong raid beats a light garrison, which falls back elsewhere, and takes the plaza', () => {
    let s = empty();
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { men: 36, skill: 4, gear: 4, vehicles: pickups(9), order: { type: 'idle' } });
    addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: 8, vehicles: pickups(2) });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }]);
    expect(battles(s)[0]!.type).toBe('raid');
    s = runUntil(s, (x) => active(x).length === 0);
    const b = battles(s)[0]!;
    expect(b.winner).toBe('attackers');
    expect(s.nodes.villa_union!.owner).toBe('c_mazatlan');
    const g = s.crews.g;
    if (g) expect(g.order.type === 'retreat' && g.order.destination !== 'villa_union').toBe(true);
  });

  it('the La Tuna scenario: a siege falls without relief and holds with it', () => {
    const setup = (relief: boolean) => {
      let s = empty('c_mazatlan', calm, 2);
      addCrew(s, 'def', 'c_la_tuna', 'la_tuna', { men: 16 });
      addCrew(s, 'att', 'm_el_salado', 'badiraguato', { men: 40, vehicles: pickups(10), order: { type: 'idle' } });
      // Without it, no one can come: the AI would otherwise send this crew on its own.
      if (relief) addCrew(s, 'rel', 'c_la_tuna', 'surutato', { men: 30, skill: 4, vehicles: pickups(8), order: { type: 'idle' } });
      s = step(s, [{ type: 'order_crew', issuer: 'm_el_salado', crew: 'att', order: { type: 'raid', target: 'la_tuna', preference: 'fastest' } }]);
      return s;
    };
    let alone = setup(false);
    const siege = battles(alone)[0]!;
    expect(siege.type).toBe('siege');
    expect(siege.fortification).toBe(2);
    alone = runUntil(alone, (x) => active(x).length === 0);
    const lost = battles(alone)[0]!;
    expect(lost.hours).toBeGreaterThanOrEqual(12);
    expect(lost.winner).toBe('attackers');
    expect(alone.nodes.la_tuna!.owner).toBe('m_el_salado');
    expect(alone.nodes.la_tuna!.fortification).toBe(1);

    // With a crew in reach, the outgunned defenders' call for help brings it in.
    let relieved = setup(true);
    expect(relieved.crews.rel!.order.type).toBe('reinforce');
    relieved = runUntil(relieved, (x) => active(x).length === 0);
    const held = battles(relieved)[0]!;
    expect(held.winner).toBe('defenders');
    expect(relieved.nodes.la_tuna!.owner).toBe('c_la_tuna');
  });
});

describe('morale, ammo, and leaders', () => {
  it('a crew near breaking routs: men captured and scattered, then it runs', () => {
    let s = empty();
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { men: 30, vehicles: pickups(8), order: { type: 'idle' } });
    addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: 20, morale: 16, vehicles: pickups(5) });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }]);
    const b = battles(s)[0]!;
    expect(b.log.some((l) => l.includes('routed'))).toBe(true);
    expect(s.crews.g!.men).toBeLessThan(20 * 0.7);
    expect(s.crews.g!.battle).toBeNull();
  });

  it('a crew out of ammunition pulls out', () => {
    let s = empty();
    // Raiders arrive nearly dry; the garrison reloads in its own plaza.
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { men: 12, ammo: 5, order: { type: 'idle' } });
    addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: 12 });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }]);
    expect(battles(s)[0]!.log.some((l) => l.includes('ran out of ammunition'))).toBe(true);
  });

  it('armored trucks soak up losses and can be destroyed', () => {
    const c = tuned((t) => {
      noBreakdowns(t);
      noAi(t);
      t.combat.armoredDamagePerAbsorbed = 100;
    });
    let s = empty('c_mazatlan', c);
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { men: 36, vehicles: pickups(9), order: { type: 'idle' } });
    addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: 6, vehicles: { pickup: 0, suv: 0, motorcycle: 0, armored: 1 } });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }], c);
    const g = s.crews.g!;
    expect(g.vehicles.armored).toBe(0);
    expect(g.men).toBeGreaterThanOrEqual(5);
  });

  it('winners gain skill with battles survived', () => {
    let s = empty();
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { men: 36, skill: 3, battles: 2, vehicles: pickups(9), order: { type: 'idle' } });
    addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: 6, morale: 16, vehicles: pickups(2) });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }]);
    s = runUntil(s, (x) => active(x).length === 0);
    expect(s.crews.r!.battles).toBe(3);
    expect(s.crews.r!.skill).toBe(4);
  });

  it('a dead player with an heir plays on as the heir', () => {
    const s = newGame(calm, { seed: 1, playerId: 'chapitos_head' });
    const ctx = newContext(s, calm);
    killCharacter(ctx, 'chapitos_head');
    expect(s.playerId).toBe('cl_el_menor');
    expect(s.nodes.badiraguato!.owner).toBe('cl_el_menor');
    expect(s.factions.chapitos!.head).toBe('cl_el_menor');
    expect(s.ended).toBeNull();
  });

  it('a dead player with no heir ends the game', () => {
    const s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    killCharacter(newContext(s, calm), 'c_mazatlan');
    expect(s.ended?.reason).toBe('player_eliminated');
  });

  it('a dead AI lieutenant with no heir leaves everything to the faction head', () => {
    const s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    killCharacter(newContext(s, calm), 'm_villa_union');
    expect(s.nodes.villa_union!.owner).toBe('mayos_head');
  });

  it('captives are ransomed after the hold period (placeholder for prisoner events)', () => {
    const c = tuned((t) => {
      noAi(t);
      t.characters.prisonerHoldDays = 1;
    });
    let s = newGame(c, { seed: 1, playerId: 'c_mazatlan' });
    const ch = s.characters.m_villa_union!;
    ch.status = 'captured';
    ch.captor = 'c_mazatlan';
    const before = cashOf(s, 'c_mazatlan');
    for (let i = 0; i < 49; i++) s = tick(s, [], c).state;
    expect(s.characters.m_villa_union!.status).toBe('free');
    expect(cashOf(s, 'c_mazatlan')).toBeGreaterThan(before);
  });
});

describe('interception and garrisons', () => {
  const c = tuned(certain);

  it('a spotted weak group passing a garrisoned rival plaza is stopped there', () => {
    let s = empty('c_mazatlan', c);
    addCrew(s, 'g', 'm_la_cruz', 'la_cruz', { men: 30, vehicles: pickups(8) });
    addCrew(s, 'x', 'c_mazatlan', 'mazatlan', { men: 6, vehicles: pickups(2), order: { type: 'idle' } });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'x', order: { type: 'move', destination: 'culiacan', preference: 'fastest' } }], c);
    s = runUntil(s, (x) => battles(x).length > 0, 5, c);
    const b = battles(s)[0]!;
    expect(b.where).toEqual({ kind: 'node', node: 'la_cruz' });
    expect(b.capture).toBe(false);
  });

  it('a group too strong for the garrison passes through', () => {
    let s = empty('c_mazatlan', c);
    addCrew(s, 'g', 'm_la_cruz', 'la_cruz', { men: 6, vehicles: pickups(2) });
    addCrew(s, 'x', 'c_mazatlan', 'mazatlan', { men: 36, vehicles: pickups(9), order: { type: 'idle' } });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'x', order: { type: 'move', destination: 'culiacan', preference: 'fastest' } }], c);
    s = runUntil(s, (x) => x.crews.x!.location.kind === 'node' && (x.crews.x!.location as { node: string }).node === 'culiacan', 6, c);
    expect(battles(s)).toEqual([]);
  });

  it('a garrison attacks intruders it spots sitting in its plaza', () => {
    let s = empty('c_mazatlan', c);
    addCrew(s, 'g', 'm_la_cruz', 'la_cruz', { men: 30, vehicles: pickups(8) });
    addCrew(s, 'x', 'c_mazatlan', 'la_cruz', { men: 6, vehicles: pickups(2), order: { type: 'idle' } });
    s = step(s, [], c);
    const b = battles(s)[0]!;
    expect(b.attackers.crews).toContain('x');
    expect(b.defenders.crews).toContain('g');
  });
});

describe('player decisions', () => {
  function fight() {
    let s = empty();
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { men: 20, vehicles: { pickup: 4, suv: 0, motorcycle: 0, armored: 1 }, order: { type: 'idle' } });
    addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: 24, vehicles: pickups(6) });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }]);
    return { s, b: active(s)[0]! };
  }

  it('withdraw in good order: out next hour, no rout', () => {
    const { s, b } = fight();
    const s2 = step(s, [{ type: 'battle_withdraw', issuer: 'c_mazatlan', battle: b.id }]);
    expect(s2.crews.r!.battle).toBeNull();
    expect(s2.battles[b.id]!.log.some((l) => l.includes('withdrew in good order'))).toBe(true);
    expect(s2.battles[b.id]!.winner).toBe('defenders');
  });

  it('armored truck forward doubles its punch for the hour', () => {
    const { s, b } = fight();
    const plain = tick(s, [], calm).state.battles[b.id]!.attackers.power;
    const pushed = tick(s, [{ type: 'battle_armor_forward', issuer: 'c_mazatlan', battle: b.id }], calm).state.battles[b.id]!.attackers.power;
    expect(pushed - plain).toBeGreaterThan(25);
  });

  it('commit reserves: a nearby crew rides in and joins', () => {
    const { s, b } = fight();
    addCrew(s, 'res', 'c_mazatlan', 'mazatlan', { men: 12, order: { type: 'idle' } });
    let s2 = step(s, [{ type: 'battle_commit', issuer: 'c_mazatlan', battle: b.id, crew: 'res' }]);
    s2 = runUntil(s2, (x) => x.crews.res?.battle === b.id || x.battles[b.id]!.endedAt !== null, 3);
    expect(s2.battles[b.id]!.attackers.owners).toContain('c_mazatlan');
    expect(s2.battles[b.id]!.log.some((l) => l.includes('joins the attackers'))).toBe(true);
  });

  it('call for help sends nearby faction crews that are not yours', () => {
    const { s, b } = fight();
    addCrew(s, 'ally', 'c_san_ignacio', 'la_noria', { men: 14 });
    const s2 = step(s, [{ type: 'battle_call_help', issuer: 'c_mazatlan', battle: b.id }]);
    // A faction crew that is not the player's rides in from La Noria.
    const o = s2.crews.ally!.order;
    expect(s2.battles[b.id]!.attackers.owners.includes('c_san_ignacio') || (o.type === 'reinforce' && o.battle === b.id)).toBe(true);
  });

  it('accept surrender when the enemy is wavering: prisoners and their trucks', () => {
    const { s, b } = fight();
    s.crews.g!.morale = 20;
    const leader = s.crews.g!.leader;
    const s2 = step(s, [{ type: 'battle_accept_surrender', issuer: 'c_mazatlan', battle: b.id }]);
    expect(s2.crews.g).toBeUndefined();
    expect(s2.characters[leader]!.status).toBe('captured');
    expect(s2.crews.r!.vehicles.pickup).toBe(4 + 6);
    expect(s2.battles[b.id]!.winner).toBe('attackers');
  });

  it('surrender is refused while the enemy still has fight in them', () => {
    const { s, b } = fight();
    const r = tick(s, [{ type: 'battle_accept_surrender', issuer: 'c_mazatlan', battle: b.id }], calm);
    expect(r.rejected[0]?.reason).toMatch(/not ready/);
  });

  it('crews in battle cannot take ordinary orders', () => {
    const { s } = fight();
    const r = tick(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'garrison' } }], calm);
    expect(r.rejected[0]?.reason).toMatch(/battle/);
  });
});

describe('Culiacán', () => {
  it('rival crews in the same colonia fight, and control shifts toward the stronger side', () => {
    let s = empty();
    addCrew(s, 'c', 'c_culiacan_norte', 'culiacan', { men: 36, vehicles: pickups(9), colonia: 'col_centro' });
    addCrew(s, 'm', 'm_culiacan_sur', 'culiacan', { men: 10, colonia: 'col_centro' });
    const start = s.colonias.col_centro!.control;
    s = step(s);
    const b = active(s)[0]!;
    expect(b.type).toBe('urban_skirmish');
    expect(b.colonia).toBe('col_centro');
    s = runUntil(s, (x) => active(x).length === 0);
    expect(s.colonias.col_centro!.control).toBeGreaterThan(start);
  });

  it('an uncontested colonia drifts toward the side holding it, and flips at 60', () => {
    let s = empty();
    s.colonias.col_tierra_blanca!.control = 59.9;
    addCrew(s, 'c', 'c_culiacan_norte', 'culiacan', { colonia: 'col_tierra_blanca' });
    s = step(s);
    expect(s.colonias.col_tierra_blanca!.control).toBeCloseTo(60.1);
    expect(s.feed.some((f) => f.text.includes('Tierra Blanca is now held by the Chapitos'))).toBe(true);
  });

  it('crews deploy to colonias only inside Culiacán', () => {
    const s = empty();
    addCrew(s, 'x', 'c_mazatlan', 'mazatlan');
    const r = tick(s, [{ type: 'deploy_crew', issuer: 'c_mazatlan', crew: 'x', colonia: 'col_centro' }], calm);
    expect(r.rejected[0]?.reason).toMatch(/inside Culiacán/);
  });
});

describe('supply and the pulse', () => {
  it('crews reload at a friendly plaza, and the owner pays', () => {
    let s = empty();
    addCrew(s, 'x', 'c_mazatlan', 'mazatlan', { ammo: 50, men: 10 });
    const cash = cashOf(s, 'c_mazatlan');
    s = step(s);
    expect(s.crews.x!.ammo).toBeCloseTo(75);
    expect(cashOf(s, 'c_mazatlan')).toBeCloseTo(cash - 30 * 10 * 0.25);
  });

  it('fighting raises calentura and exhaustion; a quiet day lets them decay', () => {
    let s = empty();
    const cal0 = s.regions.sur!.calentura;
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { men: 20, vehicles: pickups(5), order: { type: 'idle' } });
    addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: 20, vehicles: pickups(5) });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }]);
    expect(s.regions.sur!.calentura).toBeGreaterThan(cal0);
    expect(s.factions.chapitos!.supply).toBeLessThan(calm.tuning.pulse.startingSupply);
    // Run to the daily pulse: the region shows it was fighting today.
    s = runUntil(s, (x) => x.hour % 24 === 0);
    expect(['skirmishing', 'offensive']).toContain(s.regions.sur!.warState);
    const cal1 = s.regions.sur!.calentura;
    s = runUntil(s, (x) => x.hour % 24 === 0 && x.hour > 24);
    expect(s.regions.sur!.calentura).toBeLessThanOrEqual(cal1 - calm.tuning.state.calenturaDecayPerQuietDay + 1e-9);
  });
});

describe('determinism with combat', () => {
  it('same seed, same commands, same war', () => {
    const run = () => {
      let s = newGame(calm, { seed: 77, playerId: 'c_mazatlan' });
      s = tick(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: Object.values(s.crews).find((c) => c.owner === 'c_mazatlan')!.id, order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }], calm).state;
      for (let i = 0; i < 24 * 5; i++) s = tick(s, [], calm).state;
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});
