import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import { newContext } from '../src/sim/context';
import { newGame } from '../src/sim/newGame';
import { cashOf } from '../src/sim/money';
import { opinionBreakdown } from '../src/sim/opinion';
import { truceBetween } from '../src/sim/pacts';
import type { GameState } from '../src/sim/state';
import { startBattle } from '../src/sim/systems/combat';
import { conditionsMet, eventDef, fireById, fireEvent, runEventsDaily, type Instance } from '../src/sim/systems/events';
import { tick } from '../src/sim/tick';
import { addCrew, noAi, noBreakdowns, tuned } from './helpers';

/** Events on, everything else random off. */
const evc = (mut: (t: Content['tuning']) => void = () => {}) =>
  tuned((t) => {
    noAi(t);
    noBreakdowns(t);
    t.state.enabled = false;
    t.schemes.enabled = false;
    mut(t);
  });
const c = evc();

function game(content: Content = c, playerId = 'c_mazatlan'): GameState {
  return newGame(content, { seed: 7, playerId });
}

const inst = (s: GameState, id: string, scope: string, decider: string, other: string | null = null): Instance => ({ def: eventDef(c, id)!, scope, decider, other });

describe('event conditions', () => {
  it('read the scope plaza, the region, and the deciding character', () => {
    const s = game();
    const ctx = newContext(s, c);
    const petition = inst(s, 'business_petition', 'mazatlan', 'c_mazatlan');
    s.nodes.mazatlan!.extortionRate = 'high';
    expect(conditionsMet(ctx, petition.def.trigger, petition)).toBe(true);
    s.nodes.mazatlan!.extortionRate = 'low';
    expect(conditionsMet(ctx, petition.def.trigger, petition)).toBe(false);
    // Plaza events about the player's plazas do not fire for others.
    const other = inst(s, 'business_petition', 'el_rosario', 'm_rosario');
    s.nodes.el_rosario!.extortionRate = 'high';
    expect(conditionsMet(ctx, other.def.trigger, other)).toBe(false);
    const surge = inst(s, 'marines_surge', 'sur', 'c_mazatlan');
    s.regions.sur!.calentura = 80;
    expect(conditionsMet(ctx, surge.def.trigger, surge)).toBe(true);
    s.regions.sur!.calentura = 50;
    expect(conditionsMet(ctx, surge.def.trigger, surge)).toBe(false);
  });

  it('family_member_died looks for a relative killed in the last week', () => {
    const s = game();
    const ctx = newContext(s, c);
    const lt = Object.values(s.characters).find((ch) => ch.relations.some((r) => r.type === 'sibling'))!;
    const sib = lt.relations.find((r) => r.type === 'sibling')!.target;
    const i = inst(s, 'lieutenant_son_killed', lt.id, s.factions[lt.faction ?? 'chapitos']!.head!, lt.id);
    expect(conditionsMet(ctx, i.def.trigger, i)).toBe(false);
    s.characters[sib]!.status = 'dead';
    s.characters[sib]!.statusSince = s.hour;
    expect(conditionsMet(ctx, i.def.trigger, i)).toBe(true);
    s.hour += (c.tuning.events.familyDeathWindowDays + 1) * 24;
    expect(conditionsMet(ctx, i.def.trigger, i)).toBe(false);
  });
});

describe('firing and choosing', () => {
  it('a player event waits for a decision, with a critical notice', () => {
    let s = game();
    const ctx = newContext(s, c);
    expect(fireById(ctx, 'fiesta_patronal', 'mazatlan', 'c_mazatlan')).toBe(true);
    const pe = s.pendingEvents[0]!;
    expect(pe.decider).toBe('c_mazatlan');
    expect(s.feed.at(-1)!.tier).toBe('critical');
    const cash = cashOf(s, 'c_mazatlan');
    const support = s.nodes.mazatlan!.support;
    const r = tick(s, [{ type: 'choose_event_option', issuer: 'c_mazatlan', instance: pe.instance, option: 0 }], c);
    expect(r.rejected).toEqual([]);
    s = r.state;
    expect(s.pendingEvents).toEqual([]);
    expect(s.nodes.mazatlan!.support).toBe(Math.min(100, support + 15));
    expect(cashOf(s, 'c_mazatlan')).toBeLessThan(cash - 39000);
  });

  it('options the decider cannot afford are refused', () => {
    const s = game();
    const ctx = newContext(s, c);
    for (const n of Object.values(s.nodes)) if (n.owner === 'c_mazatlan') n.stash = 0;
    s.characters.c_mazatlan!.purse = 1000;
    fireById(ctx, 'fiesta_patronal', 'mazatlan', 'c_mazatlan');
    const pe = s.pendingEvents[0]!;
    const r = tick(s, [{ type: 'choose_event_option', issuer: 'c_mazatlan', instance: pe.instance, option: 0 }], c);
    expect(r.rejected[0]?.reason).toMatch(/need \$40,000/);
    expect(tick(s, [{ type: 'choose_event_option', issuer: 'c_mazatlan', instance: pe.instance, option: 1 }], c).rejected).toEqual([]);
  });

  it('unanswered events resolve themselves after a while', () => {
    let s = game();
    fireById(newContext(s, c), 'fiesta_patronal', 'mazatlan', 'c_mazatlan');
    const id = s.pendingEvents[0]!.instance;
    for (let h = 0; h <= c.tuning.events.autoResolveHours; h++) s = tick(s, [], c).state;
    expect(s.pendingEvents.some((p) => p.instance === id)).toBe(false);
    expect(s.feed.some((f) => f.text.includes('with no word from you'))).toBe(true);
  });

  it('AI deciders answer at once by option weight', () => {
    const ai = evc((t) => (t.ai.layers.events = true));
    const s = game(ai);
    const cash = cashOf(s, 'm_rosario');
    expect(fireEvent(newContext(s, ai), eventDef(ai, 'fiesta_patronal')!, 'el_rosario', 'm_rosario', null)).toBe(true);
    expect(s.pendingEvents).toEqual([]);
    expect(s.eventLog.at(-1)).toMatchObject({ event: 'fiesta_patronal', decider: 'm_rosario' });
    // Whatever it chose, it chose something valid: money only ever went down by an option's cost.
    expect(cashOf(s, 'm_rosario')).toBeLessThanOrEqual(cash);
  });

  it('with the events layer off, AI characters get no events', () => {
    const s = game();
    expect(fireEvent(newContext(s, c), eventDef(c, 'fiesta_patronal')!, 'el_rosario', 'm_rosario', null)).toBe(false);
  });

  it('a boss decides about his people: the scope character is the other', () => {
    const s0 = game(evc(), 'chapitos_head');
    let s = s0;
    const lt = 'c_la_tuna';
    const sib = s.characters[lt]!.relations.find((r) => r.type === 'sibling' || r.type === 'child' || r.type === 'parent');
    if (sib) {
      s.characters[sib.target]!.status = 'dead';
      s.characters[sib.target]!.statusSince = s.hour;
    } else {
      s.characters[lt]!.relations.push({ type: 'child', target: 'cl_el_gato' });
      s.characters.cl_el_gato!.status = 'dead';
      s.characters.cl_el_gato!.statusSince = s.hour;
    }
    // Make it certain within a day.
    const certain = evc((t) => (t.ai.layers.events = true));
    const def = certain.events.find((e) => e.id === 'lieutenant_son_killed')!;
    def.mean_days = 0.0001;
    runEventsDaily(newContext(s, certain));
    const pe = s.pendingEvents.find((e) => e.event === 'lieutenant_son_killed' && e.scope === lt);
    expect(pe).toBeDefined();
    expect(pe!.decider).toBe('chapitos_head');
    expect(pe!.other).toBe(lt);
    const r = tick(s, [{ type: 'choose_event_option', issuer: 'chapitos_head', instance: pe!.instance, option: 0 }], certain);
    expect(r.rejected).toEqual([]);
    expect(opinionBreakdown(r.state, certain, lt, 'chapitos_head').some((l) => l.key === 'lieutenant_son_killed' && l.value > 0)).toBe(true);
    expect(r.state.characters[lt]!.goal).toBe('avenge');
  });

  it('counterparts: a wedding invitation comes from an ally on your side', () => {
    const s = game();
    fireById(newContext(s, c), 'wedding_invitation', 'c_mazatlan', 'c_mazatlan');
    const pe = s.pendingEvents[0]!;
    expect(pe.other).not.toBeNull();
    expect(s.characters[pe.other!]!.faction).toBe('chapitos');
    const r = tick(s, [{ type: 'choose_event_option', issuer: 'c_mazatlan', instance: pe.instance, option: 1 }], c);
    expect(r.state.characters.c_mazatlan!.relations.some((x) => x.type === 'compadre' && x.target === pe.other)).toBe(true);
  });
});

describe('chains, schedules, and pacing', () => {
  it('follow-ups fire on schedule, and a delay holds them off', () => {
    let s = game();
    s.nodes.la_noria!.labs = 1;
    fireById(newContext(s, c), 'lab_raid_warning', 'la_noria', 'c_mazatlan');
    const warn = s.pendingEvents[0]!;
    // "Ignore it" schedules the raid in 48 hours.
    s = tick(s, [{ type: 'choose_event_option', issuer: 'c_mazatlan', instance: warn.instance, option: 2 }], c).state;
    expect(s.scheduledEvents).toContainEqual(expect.objectContaining({ event: 'army_lab_raid', scope: 'la_noria', at: 48 }));
    while (s.hour < 49) s = tick(s, [], c).state;
    expect(s.pendingEvents.some((e) => e.event === 'army_lab_raid')).toBe(true);

    let t2 = game();
    t2.nodes.la_noria!.labs = 1;
    fireById(newContext(t2, c), 'lab_raid_warning', 'la_noria', 'c_mazatlan');
    t2 = tick(t2, [{ type: 'choose_event_option', issuer: 'c_mazatlan', instance: t2.pendingEvents[0]!.instance, option: 1 }], c).state;
    expect(t2.eventBlocks).toEqual([expect.objectContaining({ event: 'army_lab_raid', scope: 'la_noria' })]);
  });

  it('the player sees at most the weekly cap of mean-time events', () => {
    const busy = evc((t) => {
      t.events.repeatCooldownDays = 0;
      t.events.chainCooldownDays = 0;
    });
    for (const e of busy.events) if (e.mean_days !== undefined) e.mean_days = 0.01;
    let s = game(busy);
    for (let d = 0; d < 3; d++) {
      runEventsDaily(newContext(s, busy));
      // Answer everything so pending events do not block repeats.
      const cmds = s.pendingEvents.map((p) => ({ type: 'choose_event_option' as const, issuer: p.decider, instance: p.instance, option: p.event === 'kingmaker_offer' ? 2 : 1 }));
      s = tick(s, cmds, busy).state;
    }
    const mine = s.eventLog.filter((e) => e.mtth && e.decider === s.playerId).length;
    expect(mine).toBe(busy.tuning.events.playerWeeklyCap);
  });
});

describe('local truces', () => {
  it('a truce stops the sides fighting in that region', () => {
    let s = game();
    for (const id of Object.keys(s.crews)) delete s.crews[id];
    fireById(newContext(s, c), 'priest_mediation', 'sur', 'c_mazatlan');
    s = tick(s, [{ type: 'choose_event_option', issuer: 'c_mazatlan', instance: s.pendingEvents[0]!.instance, option: 0 }], c).state;
    expect(truceBetween(s, 'chapitos', 'mayos', 'sur')).toBe(true);
    expect(truceBetween(s, 'chapitos', 'mayos', 'norte')).toBe(false);
    addCrew(s, 'a', 'm_rosario', 'la_noria', { men: 20 });
    addCrew(s, 'd', 'c_mazatlan', 'la_noria', { men: 10 });
    const ctx = newContext(s, c);
    expect(startBattle(ctx, { type: 'raid', attackers: ['a'], defenders: ['d'], where: { kind: 'node', node: 'la_noria' }, capture: true })).toBeNull();
    s.hour += 8 * 24;
    expect(startBattle(newContext(s, c), { type: 'raid', attackers: ['a'], defenders: ['d'], where: { kind: 'node', node: 'la_noria' }, capture: true })).not.toBeNull();
  });
});
