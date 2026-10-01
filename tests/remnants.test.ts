import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import { captureChance } from '../src/sim/capture';
import type { Command } from '../src/sim/commands';
import { cashOf } from '../src/sim/money';
import { networkOf } from '../src/sim/network';
import type { Battle, GameState } from '../src/sim/state';
import { territoryShares } from '../src/sim/systems/economy';
import { tick } from '../src/sim/tick';
import { addCrew, calm, empty, noAi, noBreakdowns, noWorld, tuned } from './helpers';

function step(s: GameState, cmds: Command[] = [], c: Content = calm): GameState {
  const r = tick(s, cmds, c);
  expect(r.rejected).toEqual([]);
  return r.state;
}
const reject = (s: GameState, cmd: Command, c: Content = calm) => tick(s, [cmd], c).rejected[0]?.reason ?? null;
function run(s: GameState, hours: number, c: Content = calm): GameState {
  for (let h = 0; h < hours && !s.ended; h++) s = tick(s, [], c).state;
  return s;
}
const only = (mut: (t: Content['tuning']) => void) =>
  tuned((t) => {
    noAi(t);
    noWorld(t);
    noBreakdowns(t);
    mut(t);
  });

/** m_villa_union held by c_mazatlan. */
function captive(s: GameState, who = 'm_villa_union', captor = 'c_mazatlan'): GameState {
  const ch = s.characters[who]!;
  ch.status = 'captured';
  ch.statusSince = s.hour;
  ch.captor = captor;
  return s;
}

describe('the capture roll', () => {
  const s = empty();
  const crew = addCrew(s, 'x', 'm_villa_union', 'villa_union', { men: 10 });
  const battle = (over: Partial<Battle> = {}) => ({ where: { kind: 'node', node: 'villa_union' }, approaches: [], ...over }) as unknown as Battle;

  it('bigger odds and encirclement make it likelier; rank makes it harder', () => {
    const even = captureChance(s, calm, battle(), crew, 100, 100, 'routed');
    expect(captureChance(s, calm, battle(), crew, 100, 400, 'routed')).toBeGreaterThan(even);
    expect(captureChance(s, calm, battle({ approaches: ['a', 'b'] }), crew, 100, 100, 'routed')).toBeGreaterThan(even);
    crew.leader = 'mayos_head';
    expect(captureChance(s, calm, battle(), crew, 100, 100, 'routed')).toBeLessThan(even);
    crew.leader = 'm_villa_union';
  });

  it('the sierra helps a boss slip away; a town traps him', () => {
    const town = captureChance(s, calm, battle(), crew, 100, 200, 'routed');
    const hills = captureChance(s, calm, battle({ where: { kind: 'node', node: 'la_tuna' } }), crew, 100, 200, 'routed');
    expect(hills).toBeLessThan(town);
  });
});

describe('captives: the captor decides', () => {
  it('ransom: his side pays, and he holds a grudge', () => {
    let s = captive(empty());
    const before = cashOf(s, 'c_mazatlan');
    s = step(s, [{ type: 'captive', issuer: 'c_mazatlan', captive: 'm_villa_union', option: 'ransom' }]);
    expect(s.characters.m_villa_union!.status).toBe('free');
    expect(cashOf(s, 'c_mazatlan')).toBeGreaterThan(before);
  });

  it('interrogation gives up his side\'s crews and costs him health', () => {
    let s = captive(empty());
    addCrew(s, 'g', 'm_concordia', 'concordia', { men: 14 });
    const health = s.characters.m_villa_union!.health;
    s = step(s, [{ type: 'captive', issuer: 'c_mazatlan', captive: 'm_villa_union', option: 'interrogate' }]);
    expect(s.reports.some((r) => r.network === 'chapitos' && r.crew === 'g')).toBe(true);
    expect(s.characters.m_villa_union!.health).toBeLessThan(health);
    expect(s.characters.m_villa_union!.status).toBe('captured');
  });

  it('execution: fear up, and his family swears vengeance', () => {
    let s = captive(empty());
    const fear = s.characters.c_mazatlan!.fear;
    s.characters.m_villa_union!.relations.push({ type: 'sibling', target: 'm_concordia' });
    s = step(s, [{ type: 'captive', issuer: 'c_mazatlan', captive: 'm_villa_union', option: 'execute' }]);
    expect(s.characters.m_villa_union!.status).toBe('dead');
    expect(s.characters.c_mazatlan!.fear).toBeGreaterThan(fear);
    expect(s.characters.m_concordia!.relations.some((r) => r.type === 'vendetta' && r.target === 'c_mazatlan')).toBe(true);
  });

  it('turning him brings him to your side', () => {
    const c = only((t) => (t.capture.turn.base = 1));
    let s = captive(empty('c_mazatlan', c));
    s = step(s, [{ type: 'captive', issuer: 'c_mazatlan', captive: 'm_villa_union', option: 'turn' }], c);
    expect(s.characters.m_villa_union!.status).toBe('free');
    expect(networkOf(s, 'm_villa_union')).toBe('chapitos');
  });

  it('handing him to the State cools things down and costs respect', () => {
    let s = captive(empty());
    s.regions.sur!.calentura = 60;
    const respect = s.characters.c_mazatlan!.respect;
    s = step(s, [{ type: 'captive', issuer: 'c_mazatlan', captive: 'm_villa_union', option: 'hand_over' }]);
    expect(s.characters.m_villa_union!.status).toBe('jailed');
    expect(s.regions.sur!.calentura).toBeLessThan(60);
    expect(s.characters.c_mazatlan!.respect).toBeLessThan(respect);
  });

  it('leverage forces a truce; release earns a debt; a trade swaps prisoners', () => {
    let s = captive(empty());
    s = step(s, [{ type: 'captive', issuer: 'c_mazatlan', captive: 'm_villa_union', option: 'leverage' }]);
    expect(s.pacts.some((p) => p.type === 'local_truce' && p.parties.includes('mayos_head') && p.parties.includes('c_mazatlan'))).toBe(true);
    captive(s, 'c_san_ignacio', 'm_concordia');
    s = step(s, [{ type: 'captive', issuer: 'c_mazatlan', captive: 'm_villa_union', option: 'trade', trade: 'c_san_ignacio' }]);
    expect(s.characters.m_villa_union!.status).toBe('free');
    expect(s.characters.c_san_ignacio!.status).toBe('free');
    expect(reject(s, { type: 'captive', issuer: 'c_mazatlan', captive: 'm_villa_union', option: 'release' })).toMatch(/not holding/);
  });

  it('AI captors choose by personality', () => {
    const c = only(() => {});
    let s = captive(empty('c_mazatlan', c), 'c_san_ignacio', 'm_villa_union');
    s.characters.m_villa_union!.traits = ['sanguinario'];
    s = run(s, c.tuning.capture.aiDecideHours + 25, c);
    expect(s.characters.c_san_ignacio!.status).toBe('dead');
    let g = captive(empty('c_mazatlan', c), 'c_san_ignacio', 'm_villa_union');
    g.characters.m_villa_union!.traits = ['codicioso'];
    g = run(g, c.tuning.capture.aiDecideHours + 25, c);
    expect(g.characters.c_san_ignacio!.status).toBe('free');
  });

  it('prisoners pass to the captor\'s heir when he dies', async () => {
    const s = captive(empty());
    const { killCharacter } = await import('../src/sim/systems/characters');
    const { newContext } = await import('../src/sim/context');
    killCharacter(newContext(s, calm), 'c_mazatlan');
    const ch = s.characters.m_villa_union!;
    expect(ch.status === 'free' || (ch.captor !== null && s.characters[ch.captor]!.status !== 'dead')).toBe(true);
  });
});

describe('a boss who has lost everything', () => {
  function strip(s: GameState, id: string): void {
    for (const n of Object.values(s.nodes)) if (n.owner === id) n.owner = 'mayos_head';
  }

  it('a Vengativo goes to ground in the hills around his old plaza', () => {
    const c = only(() => {});
    let s = empty('c_mazatlan', c);
    s.characters.m_villa_union!.traits = ['vengativo'];
    addCrew(s, 'r', 'm_villa_union', 'villa_union', { men: 12 });
    s = run(s, 2, c);
    strip(s, 'm_villa_union');
    s = run(s, 25, c);
    expect(s.crews.r!.order.type).toBe('camp');
  });

  it('a Leal serves a stronger boss on his side; his men go with him', () => {
    const c = only(() => {});
    let s = empty('c_mazatlan', c);
    s.characters.m_villa_union!.traits = ['leal'];
    addCrew(s, 'r', 'm_villa_union', 'villa_union', { men: 12 });
    addCrew(s, 'big', 'm_concordia', 'concordia', { men: 40 });
    s = run(s, 2, c);
    strip(s, 'm_villa_union');
    s = run(s, 25, c);
    expect(s.crews.r!.owner).not.toBe('m_villa_union');
    expect(networkOf(s, s.crews.r!.owner)).toBe('mayos');
  });

  it('the player is never eliminated for losing plazas alone, and chooses', () => {
    let s = empty();
    addCrew(s, 'mine', 'c_mazatlan', 'mazatlan', { men: 12 });
    s = run(s, 2);
    for (const n of Object.values(s.nodes)) if (n.owner === 'c_mazatlan') n.owner = 'chapitos_head';
    s = run(s, 25);
    expect(s.ended).toBeNull();
    expect(s.characters.c_mazatlan!.lostEverythingAt).not.toBeNull();
    s = step(s, [{ type: 'lost_everything', issuer: 'c_mazatlan', choice: 'ground' }]);
    expect(s.crews.mine!.order.type).toBe('camp');
    expect(s.characters.c_mazatlan!.lostEverythingAt).toBeNull();
  });

  it('fleeing Sinaloa ends the player\'s game', () => {
    let s = empty();
    for (const n of Object.values(s.nodes)) if (n.owner === 'c_mazatlan') n.owner = 'chapitos_head';
    s = step(s, [{ type: 'lost_everything', issuer: 'c_mazatlan', choice: 'flee' }]);
    expect(s.ended?.reason).toBe('player_fled');
  });
});

describe('the countryside', () => {
  it('camps raise a side\'s influence in the hills, and that counts toward the map share', () => {
    let s = empty();
    const before = territoryShares(s, calm).get('chapitos')!;
    addCrew(s, 'camp', 'c_mazatlan', 'villa_union', { men: 40, order: { type: 'camp', since: 0 } });
    s = run(s, 24 * 10);
    expect(s.countryside.villa_union!.chapitos ?? 0).toBeGreaterThan(20);
    expect(territoryShares(s, calm).get('chapitos')!).toBeGreaterThan(before);
  });

  it('campers stay out of fights in town', () => {
    let s = empty();
    addCrew(s, 'camp', 'm_villa_union', 'villa_union', { men: 40, order: { type: 'camp', since: 0 } });
    addCrew(s, 'r', 'c_mazatlan', 'mazatlan', { men: 12, order: { type: 'idle' } });
    s = step(s, [{ type: 'order_crew', issuer: 'c_mazatlan', crew: 'r', order: { type: 'raid', target: 'villa_union', preference: 'fastest' } }]);
    s = run(s, 12);
    expect(s.nodes.villa_union!.owner).toBe('c_mazatlan');
    expect(s.crews.camp!.battle).toBeNull();
  });

  it('a sweep fights the campers, who have the terrain; with no one there it finds nothing', () => {
    let s = empty();
    addCrew(s, 'g', 'c_mazatlan', 'mazatlan', { men: 20 });
    s = step(s, [{ type: 'sweep', issuer: 'c_mazatlan', crew: 'g' }]);
    expect(Object.values(s.battles)).toHaveLength(0);
    expect(s.feed.some((e) => /found no one/.test(e.text))).toBe(true);
    addCrew(s, 'camp', 'm_villa_union', 'mazatlan', { men: 10, order: { type: 'camp', since: 0 } });
    s = step(s, [{ type: 'sweep', issuer: 'c_mazatlan', crew: 'g' }]);
    const b = Object.values(s.battles)[0]!;
    expect(b.type).toBe('sweep');
    expect(b.defenders.crews).toContain('camp');
  });

  it('campers can strike the town from the hills', () => {
    let s = empty();
    addCrew(s, 'camp', 'm_villa_union', 'la_noria', { men: 30, order: { type: 'camp', since: 0 } });
    s = step(s, [{ type: 'order_crew', issuer: 'm_villa_union', crew: 'camp', order: { type: 'raid', target: 'la_noria', preference: 'fastest' } }]);
    s = run(s, 6);
    expect(s.nodes.la_noria!.owner).toBe('m_villa_union');
  });

  it('AI campers strike a garrison they believe they can beat', () => {
    const c = only((t) => (t.ai.layers.operational = true));
    let s = empty('c_mazatlan', c);
    addCrew(s, 'camp', 'm_villa_union', 'la_noria', { men: 40, order: { type: 'camp', since: 0 } });
    addCrew(s, 'weak', 'c_mazatlan', 'la_noria', { men: 4 });
    s.reports.push({ id: 'rep_w', network: 'mayos', crew: 'weak', owner: 'c_mazatlan', men: 4, low: 4, high: 4, vehicles: {}, where: { kind: 'node', node: 'la_noria' }, roadType: null, hour: s.hour, confidence: 'confirmed', source: 'presence', planted: false });
    s = run(s, 12, c);
    expect(Object.values(s.battles).some((b) => b.where.kind === 'node' && b.where.node === 'la_noria')).toBe(true);
  });
});

describe('the countryside, step two', () => {
  it('people in the hills watch the roads: rural lookouts', async () => {
    const { watchersOf } = await import('../src/sim/network');
    const s = empty();
    s.countryside.villa_union = { chapitos: 80 };
    const w = watchersOf(s, calm, 'villa_union');
    expect(w.some((x) => x.network === 'chapitos' && x.coverage > 0)).toBe(true);
    s.countryside.villa_union = { chapitos: 5 };
    expect(watchersOf(s, calm, 'villa_union').some((x) => x.network === 'chapitos')).toBe(false);
  });

  it('contested hills cut route income; holding them pays a rural income', async () => {
    const { dailyIncome } = await import('../src/sim/systems/economy');
    const s = empty();
    const node = calm.routes[0]!.nodes.find((n) => s.countryside[n] && s.nodes[n]!.owner)!;
    const owner = s.nodes[node]!.owner!;
    const route = (g: GameState) => dailyIncome(g, calm).filter((l) => l.node === node && (l.stream === 'trafficking' || l.stream === 'tolls')).reduce((n, l) => n + l.amount, 0);
    const calmRoute = route(s);
    const rival = networkOf(s, owner) === 'chapitos' ? 'mayos' : 'chapitos';
    s.countryside[node] = { [networkOf(s, owner)]: 50, [rival]: 50 };
    expect(route(s)).toBeLessThan(calmRoute);
    expect(dailyIncome(s, calm).some((l) => l.stream === 'rural' && l.recipient === owner && l.node === node)).toBe(true);
  });

  it('sierra labs follow the hold on the hills', async () => {
    const { labFactor } = await import('../src/sim/countryside');
    const s = empty();
    const lab = calm.nodes.find((n) => calm.tuning.countryside.labsOutsideTypes.includes(n.type) && s.nodes[n.id]!.owner)!.id;
    const own = networkOf(s, s.nodes[lab]!.owner!);
    s.countryside[lab] = { [own]: 80 };
    expect(labFactor(s, calm, lab)).toBe(1);
    s.countryside[lab] = { [own]: 20, rival_x: 80 };
    expect(labFactor(s, calm, lab)).toBeLessThan(0.5);
    expect(labFactor(s, calm, 'mazatlan')).toBe(1);
  });
});
