import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import { newContext } from '../src/sim/context';
import { cashOf } from '../src/sim/money';
import { newGame } from '../src/sim/newGame';
import type { GameState } from '../src/sim/state';
import { settleDailyIncome } from '../src/sim/systems/economy';
import { resolveCapture, runStateForcesDaily, tierOf } from '../src/sim/systems/stateForces';
import { tick } from '../src/sim/tick';
import { addCrew, noAi, noBreakdowns, order, tuned } from './helpers';

/** The State on; events on for the player; AI and schemes off. */
const sc = (mut: (t: Content['tuning']) => void = () => {}) =>
  tuned((t) => {
    noAi(t);
    noBreakdowns(t);
    t.schemes.enabled = false;
    mut(t);
  });
const c = sc();

function game(content: Content = c): GameState {
  const s = newGame(content, { seed: 3, playerId: 'c_mazatlan' });
  for (const id of Object.keys(s.crews)) delete s.crews[id];
  return s;
}

const noMtth = (t: Content['tuning']) => {
  t.events.playerWeeklyCap = 0;
};

describe('calentura tiers', () => {
  it('set military presence across the region', () => {
    const s = game();
    expect(tierOf(c, 20)).toBe('normal');
    expect(tierOf(c, 45)).toBe('elevated');
    expect(tierOf(c, 70)).toBe('surge');
    expect(tierOf(c, 90)).toBe('occupation');
    s.regions.sur!.calentura = 70;
    runStateForcesDaily(newContext(s, c));
    expect(s.nodes.mazatlan!.militaryPresence).toBe(2);
    expect(s.nodes.culiacancito!.militaryPresence).toBeLessThan(2);
  });
});

describe('checkpoints', () => {
  const always = sc((t) => {
    noMtth(t);
    t.state.checkpoints.chance.surge.highway = 1;
    t.state.checkpoints.chance.surge.paved = 1;
    t.state.checkpoints.chance.surge.brecha = 1;
  });

  it('hold a group up and take a fee in a surge', () => {
    let s = game(always);
    s.regions.sur!.calentura = 70;
    const crew = addCrew(s, 'x', 'c_mazatlan', 'mazatlan');
    const cash = cashOf(s, 'c_mazatlan');
    s = order(s, crew, { type: 'move', destination: 'la_noria', preference: 'fastest' }, always);
    expect(s.crews.x!.location.kind).toBe('road');
    expect(s.crews.x!.transit.waitUntil).toBe(s.hour + always.tuning.state.checkpoints.delayHours);
    expect(cashOf(s, 'c_mazatlan')).toBe(cash - 3 * always.tuning.state.checkpoints.feePerVehicle);
    expect(s.characters.c_mazatlan!.stateIntel).toBe(always.tuning.state.checkpoints.stateIntelPerStop);
  });

  it('a bribed commander waves your people through more often', () => {
    const mostly = sc((t) => {
      noMtth(t);
      t.state.checkpoints.chance.surge.highway = 0.5;
      t.state.checkpoints.chance.surge.paved = 0.5;
      t.state.checkpoints.bribedMultiplier = 0;
    });
    let s = game(mostly);
    s.regions.sur!.calentura = 70;
    s = tick(s, [{ type: 'bribe_commander', issuer: 'c_mazatlan', region: 'sur' }], mostly).state;
    expect(s.regions.sur!.commanderBribedBy).toBe('chapitos');
    for (let i = 0; i < 10; i++) {
      const crew = addCrew(s, `x${i}`, 'c_mazatlan', 'mazatlan');
      s = order(s, crew, { type: 'move', destination: 'la_noria', preference: 'fastest' }, mostly);
      expect(s.crews[`x${i}`]!.transit.waitUntil).toBeNull();
    }
  });
});

describe('raids', () => {
  const raidy = sc((t) => {
    noMtth(t);
    t.state.raids.dailyChance.surge = 1;
  });

  it('in a surge the army goes after labs', () => {
    const s = game(raidy);
    s.regions.sur!.calentura = 70;
    s.nodes.la_noria!.labs = 1;
    runStateForcesDaily(newContext(s, raidy));
    expect(s.scheduledEvents).toContainEqual(expect.objectContaining({ event: 'army_lab_raid', scope: 'la_noria', decider: 'c_mazatlan' }));
  });

  it('police on the payroll warn you first', () => {
    let s = game(raidy);
    s.regions.sur!.calentura = 70;
    s.nodes.la_noria!.labs = 1;
    s = tick(s, [{ type: 'bribe_police', issuer: 'c_mazatlan', region: 'sur' }], raidy).state;
    runStateForcesDaily(newContext(s, raidy));
    expect(s.pendingEvents.some((e) => e.event === 'lab_raid_warning' && e.scope === 'la_noria')).toBe(true);
    expect(s.scheduledEvents.some((e) => e.event === 'army_lab_raid' && e.scope === 'la_noria')).toBe(false);
  });

  it('a stash raid seizes part of the stash', () => {
    let s = game(raidy);
    s.nodes.mazatlan!.stash = 400000;
    s.scheduledEvents.push({ event: 'stash_house_raided', scope: 'mazatlan', decider: 'c_mazatlan', other: null, at: 1 });
    s = tick(s, [], raidy).state;
    const pe = s.pendingEvents.find((e) => e.event === 'stash_house_raided')!;
    s = tick(s, [{ type: 'choose_event_option', issuer: 'c_mazatlan', instance: pe.instance, option: 0 }], raidy).state;
    expect(s.nodes.mazatlan!.stash).toBeCloseTo(400000 * (1 - raidy.tuning.state.raids.stashSeizedShare), 0);
  });

  it('an anonymous tip sends the army after a rival', () => {
    let s = game(raidy);
    s.nodes.el_rosario!.stash = 500000;
    const before = s.characters.m_rosario!.stateIntel;
    s = tick(s, [{ type: 'tip_off', issuer: 'c_mazatlan', node: 'el_rosario' }], raidy).state;
    expect(s.characters.m_rosario!.stateIntel).toBe(before + raidy.tuning.state.tipOff.stateIntel);
    expect(s.scheduledEvents).toContainEqual(expect.objectContaining({ event: 'stash_house_raided', scope: 'el_rosario' }));
    expect(tick(s, [{ type: 'tip_off', issuer: 'c_mazatlan', node: 'mazatlan' }], raidy).rejected[0]?.reason).toMatch(/your own side/);
  });
});

describe('player options', () => {
  it('a scapegoat drops calentura fast, at a cost in men and goodwill', () => {
    let s = game();
    s.regions.sur!.calentura = 70;
    addCrew(s, 'x', 'c_mazatlan', 'mazatlan', { men: 12, leader: 'cl_el_zurdo' });
    s = tick(s, [{ type: 'hand_over_scapegoat', issuer: 'c_mazatlan', region: 'sur' }], c).state;
    expect(s.regions.sur!.calentura).toBe(70 - c.tuning.state.scapegoat.calenturaDrop);
    expect(s.crews.x!.men).toBe(12 - c.tuning.state.scapegoat.men);
    expect(s.characters.cl_el_zurdo!.opinions.c_mazatlan?.[0]?.value).toBe(c.tuning.state.scapegoat.opinion);
    expect(tick(s, [{ type: 'hand_over_scapegoat', issuer: 'c_mazatlan', region: 'sur' }], c).rejected[0]?.reason).toMatch(/so soon/);
  });

  it('lying low cools the region and halves income there', () => {
    const a = game();
    const b = game();
    a.regions.sur!.calentura = 60;
    b.regions.sur!.calentura = 60;
    const b2 = tick(b, [{ type: 'lie_low_region', issuer: 'c_mazatlan', region: 'sur' }], c).state;
    runStateForcesDaily(newContext(b2, c));
    expect(b2.regions.sur!.calentura).toBe(60 - c.tuning.state.lieLow.extraDecayPerDay);
    const cashA = cashOf(a, 'c_mazatlan');
    const cashB = cashOf(b2, 'c_mazatlan');
    settleDailyIncome(newContext(a, c));
    settleDailyIncome(newContext(b2, c));
    const gainA = cashOf(a, 'c_mazatlan') - cashA;
    const gainB = cashOf(b2, 'c_mazatlan') - cashB;
    expect(gainB).toBeLessThan(gainA * 0.8);
  });
});

describe('capture operations and prison', () => {
  const hot = sc(noMtth);

  it('a high profile fills the State intel meter; at 100 the State comes', () => {
    const s = game(hot);
    const ch = s.characters.c_mazatlan!;
    ch.profile = 90;
    ch.stateIntel = 99;
    runStateForcesDaily(newContext(s, hot));
    expect(ch.stateIntel).toBe(100);
    expect(s.pendingEvents.some((e) => e.event === 'capture_operation' && e.decider === 'c_mazatlan')).toBe(true);
    ch.profile = 10;
    ch.stateIntel = 50;
    runStateForcesDaily(newContext(s, hot));
    expect(ch.stateIntel).toBe(50 - hot.tuning.state.captureOps.decayPerDay);
  });

  it('surrender means prison, and prison ends in extradition', () => {
    const s = game(hot);
    const ctx = newContext(s, hot);
    resolveCapture(ctx, 'm_rosario', 'surrender');
    expect(s.characters.m_rosario!.status).toBe('jailed');
    s.hour += hot.tuning.characters.extraditionDays * 24;
    runStateForcesDaily(ctx);
    expect(s.characters.m_rosario!.status).toBe('extradited');
    // Plazas pass to a successor, never to the gone.
    expect(s.nodes.el_rosario!.owner).not.toBe('m_rosario');
  });

  it('fleeing costs cash and resets the meter', () => {
    const s = game(hot);
    s.characters.c_mazatlan!.stateIntel = 100;
    const cash = cashOf(s, 'c_mazatlan');
    resolveCapture(newContext(s, hot), 'c_mazatlan', 'flee');
    expect(s.characters.c_mazatlan!.status).toBe('free');
    expect(s.characters.c_mazatlan!.stateIntel).toBe(hot.tuning.state.captureOps.intelAfterEscape);
    expect(cashOf(s, 'c_mazatlan')).toBeCloseTo(cash * (1 - hot.tuning.state.captureOps.fleeCashLossShare), 0);
  });

  it('a jailed player can still pay their way out', () => {
    const sure = sc((t) => {
      noMtth(t);
      t.state.captureOps.jailBribeChance = 1;
    });
    let s = game(sure);
    resolveCapture(newContext(s, sure), 'c_mazatlan', 'surrender');
    s.pendingEvents = [];
    s.scheduledEvents.push({ event: 'in_prison', scope: 'c_mazatlan', decider: 'c_mazatlan', other: null, at: 1 });
    s = tick(s, [], sure).state;
    const pe = s.pendingEvents.find((e) => e.event === 'in_prison')!;
    expect(pe).toBeDefined();
    // Prisoners cannot run their crews, but can answer this.
    expect(tick(s, [{ type: 'set_extortion_rate', issuer: 'c_mazatlan', node: 'mazatlan', rate: 'low' }], sure).rejected[0]?.reason).toMatch(/jailed/);
    s = tick(s, [{ type: 'choose_event_option', issuer: 'c_mazatlan', instance: pe.instance, option: 0 }], sure).state;
    expect(s.characters.c_mazatlan!.status).toBe('free');
  });
});
