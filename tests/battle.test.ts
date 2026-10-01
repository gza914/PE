import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import { dealtMultiplier, takenMultiplier } from '../src/sim/battleActions';
import type { Command } from '../src/sim/commands';
import type { Battle, GameState } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { addCrew, calm, empty, noAi, noBreakdowns, noWorld, tuned } from './helpers';

const t = calm.tuning.battle;
const pickups = (n: number) => ({ pickup: n, suv: 0, motorcycle: 0, armored: 0 });

function step(s: GameState, cmds: Command[] = [], c: Content = calm): GameState {
  const r = tick(s, cmds, c);
  expect(r.rejected).toEqual([]);
  return r.state;
}
const reject = (s: GameState, cmd: Command, c: Content = calm) => tick(s, [cmd], c).rejected[0]?.reason ?? null;
const active = (s: GameState): Battle => Object.values(s.battles).find((b) => b.endedAt === null)!;

/** El del Puerto's crew raids Villa Unión. */
function fight(attackers = 20, defenders = 24, c: Content = calm, two = false) {
  let s = empty('c_mazatlan', c);
  addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { men: attackers, vehicles: pickups(Math.ceil(attackers / 4)), order: { type: 'idle' } });
  if (two) addCrew(s, 'r2', 'c_mazatlan', 'mazatlan', { men: 12, vehicles: pickups(3), order: { type: 'escort', crew: 'r' } });
  addCrew(s, 'g', 'm_villa_union', 'villa_union', { men: defenders, vehicles: pickups(6) });
  s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }], c);
  for (let i = 0; i < 6 && !active(s); i++) s = step(s, [], c);
  return s;
}

describe('stances', () => {
  it('assault deals and takes more than hold; probe deals and takes little', () => {
    const b = { stances: { a: 'assault', h: 'hold', p: 'probe' }, flank: {}, digging: [] } as unknown as Battle;
    expect(dealtMultiplier(calm, b, 'a')).toBeGreaterThan(dealtMultiplier(calm, b, 'h'));
    expect(takenMultiplier(calm, b, 'a')).toBeGreaterThan(takenMultiplier(calm, b, 'h'));
    expect(dealtMultiplier(calm, b, 'p')).toBeLessThan(1);
    expect(dealtMultiplier(calm, b, 'nobody')).toBe(1);
  });

  it('a flank needs two crews and room to move', () => {
    const s = fight();
    const b = active(s);
    expect(reject(s, { type: 'battle_stance', issuer: 'c_mazatlan', battle: b.id, stance: 'flank' })).toMatch(/needs 2 crews|no room/);
  });

  it('a flank that works hits hard; one that fails leaves them exposed', () => {
    const b = { stances: { a: 'flank', f: 'flank' }, flank: { a: true, f: false }, digging: [] } as unknown as Battle;
    expect(dealtMultiplier(calm, b, 'a')).toBe(t.flank.successDealt);
    expect(takenMultiplier(calm, b, 'f')).toBe(t.flank.failTaken);
  });

  it('a probe shows the enemy\'s true strength', () => {
    let s = fight();
    const b = active(s);
    s = step(s, [{ type: 'battle_stance', issuer: 'c_mazatlan', battle: b.id, stance: 'probe' }]);
    const r = s.reports.filter((x) => x.network === 'chapitos' && x.crew === 'g').at(-1)!;
    expect(r.low).toBe(r.high);
    expect(r.men).toBe(s.crews.g?.men ?? r.men);
  });

  it('the player is asked for a stance every few hours', () => {
    let s = fight(30, 30);
    const before = s.feed.length;
    for (let i = 0; i < t.decisionEveryHours + 1 && active(s); i++) s = step(s);
    expect(s.feed.slice(before).some((e) => /pick your stance/.test(e.text))).toBe(true);
  });

  it('AI owners pick a stance', () => {
    const c = tuned((x) => {
      noAi(x);
      noWorld(x);
      noBreakdowns(x);
      x.ai.layers.tactical = true;
    });
    let s = fight(20, 24, c);
    s = step(s, [], c);
    const b = Object.values(s.battles)[0]!;
    expect(b.stances.m_villa_union).toBeDefined();
  });
});

describe('battle actions', () => {
  it('defenders dig in: an hour of work for a level of fortification', () => {
    let s = empty();
    addCrew(s, 'g', 'c_mazatlan', 'la_noria', { men: 30, vehicles: pickups(8) });
    addCrew(s, 'r', 'm_villa_union', 'villa_union', { men: 20, vehicles: pickups(5), order: { type: 'idle' } });
    s = step(s, [{ type: 'order_crew', issuer: 'm_villa_union', crew: 'r', order: { type: 'raid', target: 'la_noria', preference: 'fastest' } }]);
    for (let i = 0; i < 8 && !active(s); i++) s = step(s);
    const b = active(s);
    const fort = b.fortification;
    s = step(s, [{ type: 'battle_dig_in', issuer: 'c_mazatlan', battle: b.id }]);
    expect(s.battles[b.id]!.fortification).toBe(Math.min(t.digIn.maxFortification, fort + 1));
  });

  it('only defenders can dig in', () => {
    const s = fight();
    expect(reject(s, { type: 'battle_dig_in', issuer: 'c_mazatlan', battle: active(s).id })).toMatch(/only defenders/);
  });

  it('a drone overhead shows who is coming to help them', () => {
    let s = fight(30, 24);
    const b = active(s);
    addCrew(s, 'help', 'm_concordia', 'concordia', { men: 15, order: { type: 'idle' } });
    s = step(s, [
      { type: 'order_crew', issuer: 'm_concordia', crew: 'help', order: { type: 'move', destination: 'villa_union', preference: 'fastest' } },
      { type: 'battle_drone', issuer: 'c_mazatlan', battle: b.id },
    ]);
    expect(s.reports.some((r) => r.network === 'chapitos' && r.crew === 'help' && r.source === 'drone')).toBe(true);
  });

  it('a beaten enemy takes terms and pulls out; a strong one refuses', () => {
    let s = fight(44, 14);
    const b = active(s);
    s = step(s, [{ type: 'battle_terms', issuer: 'c_mazatlan', battle: b.id }]);
    expect(s.battles[b.id]!.log.some((l) => /took terms/.test(l))).toBe(true);
    let g = fight(12, 40);
    const gb = active(g);
    g = step(g, [{ type: 'battle_terms', issuer: 'c_mazatlan', battle: gb.id }]);
    expect(g.feed.some((e) => /refused your terms/.test(e.text))).toBe(true);
  });

  it('executing prisoners after a win: fear up, calentura up, the region turns', () => {
    let s = fight(60, 12);
    for (let i = 0; i < 30 && active(s); i++) s = step(s);
    const b = Object.values(s.battles)[0]!;
    b.prisoners.chapitos = 5;
    if (b.winner !== 'attackers') b.winner = 'attackers';
    const fear = s.characters.c_mazatlan!.fear;
    const support = s.nodes.villa_union!.support;
    s = step(s, [{ type: 'battle_execute', issuer: 'c_mazatlan', battle: b.id }]);
    expect(s.characters.c_mazatlan!.fear).toBeGreaterThan(fear);
    expect(s.nodes.villa_union!.support).toBeLessThan(support);
    expect(reject(s, { type: 'battle_execute', issuer: 'c_mazatlan', battle: b.id })).toMatch(/no prisoners/);
  });

  it('hit the relief column: a crew takes up an ambush on its road', () => {
    let s = fight(30, 24);
    const b = active(s);
    addCrew(s, 'help', 'm_concordia', 'concordia', { men: 15, order: { type: 'idle' } });
    addCrew(s, 'hunter', 'c_mazatlan', 'mazatlan', { men: 12 });
    s = step(s, [{ type: 'order_crew', issuer: 'm_concordia', crew: 'help', order: { type: 'move', destination: 'villa_union', preference: 'fastest' } }]);
    s = step(s, [{ type: 'battle_drone', issuer: 'c_mazatlan', battle: b.id }]);
    if (s.crews.help!.location.kind !== 'road') return;
    s = step(s, [{ type: 'battle_relief', issuer: 'c_mazatlan', battle: b.id, crew: 'hunter', target: 'help' }]);
    expect(s.crews.hunter!.order.type).toBe('ambush');
  });
});

describe('regressions', () => {
  it('an owner who changed sides mid-fight still gets a stance (no crash)', async () => {
    const { aiStance } = await import('../src/sim/battleActions');
    const s = fight(30, 24);
    const b = active(s);
    s.characters.m_villa_union!.faction = 'chapitos';
    expect(['assault', 'hold', 'flank', 'probe']).toContain(aiStance(s, calm, b, 'm_villa_union'));
    expect(aiStance(s, calm, b, 'nobody_here')).toBe('hold');
  });
});
