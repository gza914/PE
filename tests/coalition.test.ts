import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import { newContext } from '../src/sim/context';
import { cashOf } from '../src/sim/money';
import { newGame } from '../src/sim/newGame';
import { opinionBreakdown, opinionOf } from '../src/sim/opinion';
import { pactBetween } from '../src/sim/pacts';
import type { Battle, GameState } from '../src/sim/state';
import { plazaRecipient, startBattle } from '../src/sim/systems/combat';
import { tick } from '../src/sim/tick';
import { addCrew, noAi, noBreakdowns, noWorld, tuned } from './helpers';

/** Only the coalition AI on; no random world. */
const cc = (mut: (t: Content['tuning']) => void = () => {}) =>
  tuned((t) => {
    noAi(t);
    noWorld(t);
    noBreakdowns(t);
    t.ai.layers.coalition = true;
    t.ai.trafficChancePerCheck = 0;
    mut(t);
  });
const c = cc();

function game(content: Content = c, playerId = 'c_mazatlan'): GameState {
  const s = newGame(content, { seed: 9, playerId });
  for (const id of Object.keys(s.crews)) delete s.crews[id];
  return s;
}

function run(s: GameState, content: Content, hours: number): GameState {
  for (let h = 0; h < hours && !s.ended; h++) s = tick(s, [], content).state;
  return s;
}

const loss = (n: string) => (s: GameState, a: string, b: string) => opinionBreakdown(s, c, a, b).find((l) => l.key === n)?.value ?? 0;

describe('spoils by contribution', () => {
  it('blood outweighs headcount', () => {
    const s = game();
    const a = addCrew(s, 'a', 'c_mazatlan', 'villa_union', { men: 30 });
    const b = addCrew(s, 'b', 'c_san_ignacio', 'villa_union', { men: 5 });
    const battle = {
      attackers: { network: 'chapitos', ownerMen: { c_mazatlan: 30, c_san_ignacio: 15 }, ownerLosses: { c_san_ignacio: 10 } },
      defenders: { network: 'mayos', ownerMen: {}, ownerLosses: {} },
    } as unknown as Battle;
    // c_mazatlan: 30; c_san_ignacio: 15 + 2 × 10 = 35.
    expect(plazaRecipient(newContext(s, c), 'villa_union', [a, b], battle)).toBe('c_san_ignacio');
    battle.attackers.ownerLosses = { c_san_ignacio: 5 };
    expect(plazaRecipient(newContext(s, c), 'villa_union', [a, b], battle)).toBe('c_mazatlan');
  });
});

describe('joint operations', () => {
  const setup = (content: Content = c) => {
    const s = game(content);
    addCrew(s, 'mine', 'c_mazatlan', 'mazatlan', { men: 20 });
    addCrew(s, 'ally', 'c_san_ignacio', 'san_ignacio', { men: 30 });
    addCrew(s, 'ally_home', 'c_san_ignacio', 'san_ignacio', { men: 35 });
    addCrew(s, 'def', 'm_villa_union', 'villa_union', { men: 8 });
    return s;
  };
  const propose = (s: GameState, content: Content, extra: Partial<Record<string, unknown>> = {}) =>
    tick(s, [{ type: 'propose_operation', issuer: 'c_mazatlan', kind: 'attack', target: 'villa_union', strikeAt: s.hour + 20, plaza: 'contribution', crews: ['mine'], invites: [{ to: 'c_san_ignacio' }], ...extra } as never], content);

  it('an ally who can spare men and likes the odds joins, and his crews are sent to arrive together', () => {
    const easy = cc((t) => (t.coalition.ai.threshold = -100));
    let s = setup(easy);
    const r = propose(s, easy);
    expect(r.rejected).toEqual([]);
    s = run(r.state, easy, 2);
    const op = s.operations[0]!;
    expect(op.invites[0]!.status).toBe('accepted');
    const sent = op.invites[0]!.crews.map((id) => s.crews[id]!);
    expect(sent.length).toBeGreaterThan(0);
    for (const crew of sent) expect(crew.order).toMatchObject({ type: 'raid', target: 'villa_union', arriveAt: op.strikeAt });
    expect(s.crews.mine!.order).toMatchObject({ type: 'raid', arriveAt: op.strikeAt });
  });

  it('a threatened ally says no, with the reason, and refusing costs nothing', () => {
    let s = setup();
    // Rival crews right next to his plaza.
    addCrew(s, 'threat', 'm_villa_union', 'la_noria', { men: 40 });
    s.reports.push({ id: 'rep_x', network: 'chapitos', crew: 'threat', owner: 'm_villa_union', men: 200, vehicles: {}, where: { kind: 'node', node: 'la_noria' }, roadType: null, hour: s.hour, confidence: 'confirmed', source: 'presence', planted: false });
    const before = opinionOf(s, c, 'c_san_ignacio', 'c_mazatlan');
    s = run(propose(s, c).state, c, 2);
    const inv = s.operations[0]!.invites[0]!;
    expect(inv.status).toBe('declined');
    expect(inv.reason).toMatch(/needs his men home/);
    expect(opinionOf(s, c, 'c_san_ignacio', 'c_mazatlan')).toBe(before);
  });

  it('bad odds get a no with the estimate', () => {
    let s = setup();
    for (const id of ['ally', 'ally_home']) s.crews[id]!.men = 4;
    s.crews.mine!.men = 4;
    s = run(propose(s, c).state, c, 2);
    expect(s.operations[0]!.invites[0]!.reason).toMatch(/does not think it can work/);
  });

  it('a counter-offer for the plaza, accepted, sends the plaza his way', () => {
    const greedy = cc((t) => {
      t.coalition.ai.threshold = 1.5;
      t.coalition.ai.riskPenalty = 0;
      t.coalition.ai.opinionWeight = 0;
      t.coalition.ai.valuePerPoint = 500;
    });
    let s = setup(greedy);
    s = run(propose(s, greedy, { plaza: 'proposer' }).state, greedy, 2);
    const inv = s.operations[0]!.invites[0]!;
    expect(inv.status).toBe('countered');
    expect(inv.counter?.plaza).toBe(true);
    s = tick(s, [{ type: 'accept_counter', issuer: 'c_mazatlan', op: s.operations[0]!.id, invitee: 'c_san_ignacio' }], greedy).state;
    expect(s.operations[0]!.invites[0]!.status).toBe('accepted');
    expect(s.operations[0]!.plaza).toBe('c_san_ignacio');
  });

  it('cash offered is paid when the ally accepts', () => {
    const easy = cc((t) => (t.coalition.ai.threshold = -100));
    let s = setup(easy);
    const mine = cashOf(s, 'c_mazatlan');
    const his = cashOf(s, 'c_san_ignacio');
    s = run(propose(s, easy, { invites: [{ to: 'c_san_ignacio', cash: 50000 }] }).state, easy, 2);
    expect(cashOf(s, 'c_mazatlan')).toBe(mine - 50000);
    expect(cashOf(s, 'c_san_ignacio')).toBe(his + 50000);
  });

  it('agreeing and not showing up is remembered; showing up is not', () => {
    const easy = cc((t) => (t.coalition.ai.threshold = -100));
    let s = setup(easy);
    s = run(propose(s, easy).state, easy, 2);
    // His crews turn back: he never arrives.
    for (const id of s.operations[0]!.invites[0]!.crews) s.crews[id]!.order = { type: 'garrison' };
    s.crews.mine!.order = { type: 'garrison' };
    s = run(s, easy, 20 + easy.tuning.coalition.resolveWindowHours + 2);
    expect(s.operations[0]!.result).toBe('failed');
    expect(loss('did_not_show')(s, 'c_mazatlan', 'c_san_ignacio')).toBeLessThan(0);
  });

  it('the agreed plaza rule decides who takes the plaza', () => {
    let s = setup();
    s.operations.push({
      id: 'op_t',
      kind: 'attack',
      proposer: 'c_mazatlan',
      target: 'villa_union',
      strikeAt: s.hour,
      holdUntil: null,
      plaza: 'c_san_ignacio',
      crews: ['mine'],
      invites: [{ to: 'c_san_ignacio', status: 'accepted', cash: 0, incomeShare: 0, incomeWeeks: 0, crews: ['ally'], reason: null, counter: null, answeredAt: 0 }],
      status: 'planning',
      createdAt: 0,
      leaked: false,
      result: null,
      fought: [],
    });
    delete s.crews.def;
    s.crews.mine!.location = { kind: 'node', node: 'villa_union' };
    s.crews.ally!.location = { kind: 'node', node: 'villa_union' };
    startBattle(newContext(s, c), { type: 'raid', attackers: ['mine', 'ally'], defenders: [], where: { kind: 'node', node: 'villa_union' }, capture: true });
    expect(s.nodes.villa_union!.owner).toBe('c_san_ignacio');
  });

  it('plans can leak to the defenders', () => {
    const leaky = cc((t) => {
      t.coalition.ai.threshold = -100;
      t.coalition.leak.base = 1;
    });
    let s = setup(leaky);
    s = run(propose(s, leaky, { strikeAt: s.hour + 60 }).state, leaky, 30);
    expect(s.operations[0]!.leaked).toBe(true);
    expect(s.reports.some((r) => r.network === 'mayos' && r.source === 'rumor')).toBe(true);
  });

  it('allies can be asked to help hold a plaza', () => {
    const easy = cc((t) => (t.coalition.ai.threshold = -100));
    let s = setup(easy);
    const r = tick(s, [{ type: 'propose_operation', issuer: 'c_mazatlan', kind: 'defend', target: 'mazatlan', strikeAt: s.hour + 10, holdUntil: s.hour + 30, plaza: 'proposer', crews: [], invites: [{ to: 'c_san_ignacio' }] }], easy);
    expect(r.rejected).toEqual([]);
    s = run(r.state, easy, 40);
    expect(s.operations[0]!.result).toBe('held');
    expect(loss('did_not_show')(s, 'c_mazatlan', 'c_san_ignacio')).toBe(0);
  });

  it('validates proposals', () => {
    const s = setup();
    expect(propose(s, c, { target: 'mazatlan_port' }).rejected[0]?.reason).toMatch(/other side holds/);
    expect(propose(s, c, { invites: [{ to: 'm_rosario' }] }).rejected[0]?.reason).toMatch(/not on your side/);
    expect(propose(s, c, { strikeAt: s.hour + 1000 }).rejected[0]?.reason).toMatch(/strike between/);
  });
});

describe('pacts', () => {
  it('a paid non-aggression pact stops the two bosses fighting, and breaking it is remembered', () => {
    let s = game();
    const r = tick(s, [{ type: 'propose_pact', issuer: 'c_mazatlan', to: 'm_villa_union', pact: 'non_aggression', cash: 500000, days: 30 }], c);
    expect(r.rejected).toEqual([]);
    s = run(r.state, c, 2);
    const pact = pactBetween(s, 'c_mazatlan', 'm_villa_union', 'non_aggression');
    expect(pact).toBeDefined();
    expect(pact!.secret).toBe(true);
    addCrew(s, 'a', 'c_mazatlan', 'villa_union', { men: 20 });
    addCrew(s, 'd', 'm_villa_union', 'villa_union', { men: 8 });
    expect(startBattle(newContext(s, c), { type: 'raid', attackers: ['a'], defenders: ['d'], where: { kind: 'node', node: 'villa_union' }, capture: true })).toBeNull();
    s = tick(s, [{ type: 'break_pact', issuer: 'c_mazatlan', pact: pact!.id }], c).state;
    expect(pactBetween(s, 'c_mazatlan', 'm_villa_union', 'non_aggression')).toBeUndefined();
    expect(opinionBreakdown(s, c, 'm_villa_union', 'c_mazatlan').some((l) => l.key === 'broke_our_pact')).toBe(true);
  });

  it('mutual defense: an AI partner sends a crew when the plaza is attacked', () => {
    let s = game();
    s.pacts.push({ id: 'p1', type: 'mutual_defense', parties: ['c_mazatlan', 'c_san_ignacio'], secret: false, expiresAt: null, region: null, calls: [] });
    addCrew(s, 'helper', 'c_san_ignacio', 'san_ignacio', { men: 20 });
    addCrew(s, 'g', 'c_mazatlan', 'mazatlan', { men: 10 });
    addCrew(s, 'att', 'm_villa_union', 'mazatlan', { men: 20 });
    startBattle(newContext(s, c), { type: 'raid', attackers: ['att'], defenders: ['g'], where: { kind: 'node', node: 'mazatlan' }, capture: true });
    expect(s.crews.helper!.order.type).toBe('reinforce');
    expect(s.pacts[0]!.calls?.[0]).toMatchObject({ caller: 'c_mazatlan' });
  });

  it('a route share pays the partner every day', () => {
    let s = game();
    const route = c.routes.find((r) => r.nodes.some((n) => s.nodes[n]?.owner === 'c_mazatlan'))!;
    s.pacts.push({ id: 'p2', type: 'route_share', parties: ['c_mazatlan', 'c_san_ignacio'], secret: false, expiresAt: null, region: null, route: route.id, share: 0.5 });
    const before = cashOf(s, 'c_san_ignacio');
    s = run(s, c, 25);
    expect(s.characters.c_san_ignacio!.ledger.some((d) => (d.income.deals ?? 0) > 0)).toBe(true);
    expect(cashOf(s, 'c_san_ignacio')).toBeGreaterThan(before);
  });

  it('validates offers', () => {
    const s = game();
    expect(tick(s, [{ type: 'propose_pact', issuer: 'c_mazatlan', to: 'c_san_ignacio', pact: 'non_aggression' }], c).rejected[0]?.reason).toMatch(/own side/);
    expect(tick(s, [{ type: 'propose_pact', issuer: 'c_mazatlan', to: 'm_rosario', pact: 'mutual_defense' }], c).rejected[0]?.reason).toMatch(/own side/);
  });
});

describe('coalition rules', () => {
  it('refusing the head costs little; a levy can be paid in part', () => {
    let s = game();
    s.requests.push({ id: 'rq', faction: 'chapitos', from: 'chapitos_head', to: 'c_mazatlan', kind: 'levy', target: null, crews: [], amount: 100000, arriveBy: null, offensive: null, createdAt: 0, respondBy: 50, status: 'pending', resolvedAt: null });
    s = tick(s, [{ type: 'respond_request', issuer: 'c_mazatlan', request: 'rq', accept: true, amount: 40000 }], c).state;
    expect(s.requests[0]!.status).toBe('fulfilled');
    const credit = opinionBreakdown(s, c, 'chapitos_head', 'c_mazatlan').find((l) => l.key === 'paid_part_of_a_levy')!.value;
    expect(credit).toBeCloseTo(c.tuning.ai.requests.fulfilledOpinion * 0.4, 1);
    expect(c.tuning.ai.requests.declinedOpinion).toBeGreaterThan(-5);
  });

  it('leaving a coalition is politics: the grudge fades', () => {
    let s = game();
    s.hour = 100;
    s = tick(s, [{ type: 'declare_alignment', issuer: 'c_mazatlan', faction: 'mayos' }], c).state;
    const mod = s.characters.chapitos_head!.opinions.c_mazatlan!.find((m) => m.key === 'traitor')!;
    expect(mod.decayDays).toBe(c.tuning.diplomacy.traitorDecayDays);
  });
});
