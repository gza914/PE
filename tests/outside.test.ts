import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import { actingHead } from '../src/sim/ai/strategic';
import type { Command } from '../src/sim/commands';
import { newContext } from '../src/sim/context';
import { cashOf } from '../src/sim/money';
import { networkOf } from '../src/sim/network';
import { askPrice, contactVia, contingentLosses, contingentWon, NO_OFFER } from '../src/sim/outside';
import type { GameState, OutsideAsk, OutsideOffer } from '../src/sim/state';
import { killCharacter } from '../src/sim/systems/characters';
import { territoryShares } from '../src/sim/systems/economy';
import { tick } from '../src/sim/tick';
import { calm, empty, noAi, noBreakdowns, noWorld, tuned } from './helpers';

const t = calm.tuning.outside;
const men = (n = 10, node = 'mazatlan'): OutsideAsk => ({ kind: 'men', tier: 'sicarios', men: n, node });
const offer = (o: Partial<OutsideOffer>): OutsideOffer => ({ ...NO_OFFER, ...o });

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
function rich(s: GameState, id = 'c_mazatlan', cash = 2e6): GameState {
  s.characters[id]!.purse = cash;
  return s;
}
const price = (s: GameState, ask: OutsideAsk, client = 'c_mazatlan', cartel = 'cjng') => askPrice(s, calm, cartel, client, ask).upfront;
const deal = (cartel: string, ask: OutsideAsk, o: OutsideOffer, id?: string): Command => ({ type: 'outside_deal', issuer: 'c_mazatlan', cartel, ask, offer: o, deal: id ?? null });

describe('who deals, and how to reach them', () => {
  it('a port gives contact; without one you wait for an envoy', () => {
    const s = empty('c_mazatlan');
    expect(contactVia(s, calm, 'c_mazatlan', 'cjng')).toMatch(/port/);
    const t2 = empty('c_sanalona');
    rich(t2, 'c_sanalona');
    expect(reject(t2, { type: 'outside_deal', issuer: 'c_sanalona', cartel: 'cjng', ask: men(10, 'sanalona'), offer: offer({ cash: 1e6 }) })).toMatch(/no way to reach/);
    t2.outsiders.cjng!.envoys.c_sanalona = t2.hour + 100;
    expect(reject(t2, { type: 'outside_deal', issuer: 'c_sanalona', cartel: 'cjng', ask: men(10, 'sanalona'), offer: offer({ cash: 1e6 }) })).toBeNull();
  });

  it('only faction heads and the player deal', () => {
    const s = rich(empty('c_mazatlan'), 'm_los_mochis');
    expect(reject(s, { type: 'outside_deal', issuer: 'm_los_mochis', cartel: 'cjng', ask: men(10, 'los_mochis'), offer: offer({ cash: 1e6 }) })).toMatch(/faction heads/);
  });

  it('neutrals get better terms', () => {
    const s = empty('c_mazatlan');
    const aligned = price(s, men());
    s.characters.c_mazatlan!.faction = null;
    expect(price(s, men())).toBeCloseTo(aligned * t.neutralDiscount);
  });
});

describe('negotiation', () => {
  it('paying the price gets men: a contingent you command that stays theirs', () => {
    let s = rich(empty());
    const p = price(s, men(10));
    const head = cashOf(s, 'o_cjng');
    s = step(s, [deal('cjng', men(10), offer({ cash: p }))]);
    const crew = Object.values(s.crews).find((c) => c.hired?.kind === 'contingent')!;
    expect(crew.owner).toBe('c_mazatlan');
    expect(crew.men).toBe(10);
    expect(crew.skill).toBe(t.cartels.cjng!.tiers.sicarios!.skill);
    expect(crew.hired!.from).toBe('cjng');
    expect(crew.hired!.weekly).toBe(10 * t.cartels.cjng!.tiers.sicarios!.weeklyPerMan);
    expect(cashOf(s, 'o_cjng')).toBeGreaterThan(head);
    expect(s.outsideDeals[0]!.status).toBe('agreed');
  });

  it('a low offer gets a counter; taking it closes the deal', () => {
    let s = rich(empty());
    const p = price(s, men(10));
    s = step(s, [deal('cjng', men(10), offer({ cash: p / 2 }))]);
    const d = s.outsideDeals[0]!;
    expect(d.status).toBe('open');
    expect(d.counter!.cash).toBeGreaterThan(p / 2);
    expect(d.counter!.cash).toBeLessThan(p);
    s = step(s, [{ type: 'outside_accept', issuer: 'c_mazatlan', deal: d.id }]);
    expect(s.outsideDeals[0]!.status).toBe('agreed');
    expect(Object.values(s.crews).some((c) => c.hired?.kind === 'contingent')).toBe(true);
  });

  it('after three low rounds they walk and stop taking calls', () => {
    let s = rich(empty());
    s = step(s, [deal('cjng', men(10), offer({ cash: 1000 }))]);
    const id = s.outsideDeals[0]!.id;
    s = step(s, [deal('cjng', men(10), offer({ cash: 2000 }), id)]);
    s = step(s, [deal('cjng', men(10), offer({ cash: 3000 }), id)]);
    expect(s.outsideDeals[0]!.status).toBe('walked');
    expect(reject(s, deal('cjng', men(10), offer({ cash: 1e6 })))).toMatch(/not taking your calls/);
  });

  it('a plaza now makes them an associate of your coalition', () => {
    let s = rich(empty());
    s = step(s, [deal('cjng', men(10), offer({ plazaNow: 'la_noria' }))]);
    expect(s.outsideDeals[0]!.status).toBe('agreed');
    expect(s.nodes.la_noria!.owner).toBe('o_cjng');
    expect(networkOf(s, 'o_cjng')).toBe(networkOf(s, 'c_mazatlan'));
    expect(Object.values(s.crews).some((c) => c.owner === 'o_cjng' && c.location.kind === 'node' && c.location.node === 'la_noria')).toBe(true);
    // Their plaza counts toward your side's share.
    const before = territoryShares(empty(), calm).get('chapitos')!;
    expect(territoryShares(s, calm).get('chapitos')!).toBeCloseTo(before, 6);
    // They never stand in for your head.
    killCharacter(newContext(s, calm), 'chapitos_head');
    expect(actingHead(newContext(s, calm), 'chapitos')).not.toBe('o_cjng');
  });

  it('a plaza promised later: they come to collect', () => {
    let s = rich(empty());
    const p = price(s, men(10));
    s = step(s, [deal('cjng', men(10), offer({ cash: p * 0.5, plazaLater: 'la_noria' }))]);
    const d = s.outsideDeals[0]!;
    if (d.status === 'open') s = step(s, [{ type: 'outside_accept', issuer: 'c_mazatlan', deal: d.id }]);
    expect(s.outsiders.cjng!.promises).toHaveLength(1);
    s = run(s, t.promiseDueDays * 24 + 24);
    expect(s.nodes.la_noria!.owner).toBe('o_cjng');
  });

  it('a loan is paid back with interest', () => {
    let s = rich(empty(), 'c_mazatlan', 1e6);
    s = step(s, [deal('cdg', { kind: 'loan', amount: 200000 }, NO_OFFER)]);
    const lender = cashOf(s, 'o_cdg');
    s = run(s, t.loan.weeks * 7 * 24 + 24);
    expect(s.outsiders.cdg!.loans).toHaveLength(0);
    expect(cashOf(s, 'o_cdg') - lender).toBeGreaterThanOrEqual(200000 * (1 + t.loan.interest) - 1);
  });

  it('a loan not paid back makes them angry', () => {
    let s = empty('c_sanalona');
    s.outsiders.cdg!.envoys.c_sanalona = 1e9;
    s = step(s, [{ type: 'outside_deal', issuer: 'c_sanalona', cartel: 'cdg', ask: { kind: 'loan', amount: 200000 }, offer: NO_OFFER }]);
    s.characters.c_sanalona!.purse = 0;
    for (const n of Object.values(s.nodes)) if (n.owner === 'c_sanalona') (n.stash = 0), (n.businesses = 0), (n.labs = 0);
    s = run(s, t.loan.weeks * 7 * 24 + 24);
    expect(s.outsiders.cdg!.attitude.c_sanalona!).toBeLessThan(0);
  });
});

describe('contingents', () => {
  function hired(content: Content = calm) {
    let s = rich(empty('c_mazatlan', content));
    s = step(s, [deal('cjng', men(10), offer({ cash: price(s, men(10)) }))], content);
    return { s, id: Object.values(s.crews).find((c) => c.hired?.kind === 'contingent')!.id };
  }

  it('go home when their boss dies', () => {
    const { s, id } = hired();
    killCharacter(newContext(s, calm), 'c_mazatlan');
    const after = run(s, 25);
    expect(after.crews[id]).toBeUndefined();
  });

  it('can be recalled, with warning', () => {
    const c = tuned((x) => {
      noAi(x);
      noWorld(x);
      noBreakdowns(x);
      x.outside.cartels.cjng!.recallChancePerWeek = 1;
    });
    let { s, id } = hired(c);
    s = run(s, 10 * 24, c);
    expect(s.crews[id]).toBeUndefined();
    expect(s.feed.some((e) => /calling its 10 men home/.test(e.text))).toBe(true);
  });

  it('a loyal contingent may offer to stay; accepting makes its cartel an enemy', () => {
    const c = tuned((x) => {
      noAi(x);
      noWorld(x);
      noBreakdowns(x);
      x.outside.loyalty.start = 95;
      x.outside.loyalty.defectChancePerWeek = 1;
      x.outside.cartels.cjng!.recallChancePerWeek = 0;
    });
    let { s, id } = hired(c);
    s = run(s, 8 * 24, c);
    expect(s.crews[id]!.hired!.defectOffer).not.toBeNull();
    s = step(s, [{ type: 'answer_defection', issuer: 'c_mazatlan', crew: id, accept: true }], c);
    expect(s.crews[id]!.hired).toBeNull();
    expect(s.outsiders.cjng!.hostile).toContain('c_mazatlan');
  });

  it('losses cost loyalty, wins earn it', () => {
    const { s, id } = hired();
    const crew = s.crews[id]!;
    const before = crew.hired!.loyalty;
    contingentLosses(crew, 0.5, calm);
    expect(crew.hired!.loyalty).toBeCloseTo(before + 0.5 * t.loyalty.perLossShare);
    contingentWon(crew, calm);
    expect(crew.hired!.loyalty).toBeCloseTo(before + 0.5 * t.loyalty.perLossShare + t.loyalty.perWin);
  });
});

describe('ambition', () => {
  it('peaks while their partner is weak, and then they declare for themselves', () => {
    const c = tuned((x) => {
      noAi(x);
      noWorld(x);
      noBreakdowns(x);
      x.outside.ambition.partnerWeakShare = 1;
      x.outside.ambition.perDayWeak = 30;
    });
    let s = rich(empty('c_mazatlan', c));
    s = step(s, [deal('cjng', men(10), offer({ plazaNow: 'la_noria' }))], c);
    s = run(s, 6 * 24, c);
    expect(s.outsiders.cjng!.declared).toBe(true);
    expect(networkOf(s, 'o_cjng')).toBe('cjng');
  });
});

describe('AI', () => {
  it('a head whose side is losing hires a contingent', () => {
    const c = tuned((x) => {
      noAi(x);
      noWorld(x);
      noBreakdowns(x);
      x.ai.layers.outside = true;
      x.outside.ai.dailyChance = 1;
      x.outside.ai.hireWhenRatioBelow = 10;
    });
    let s = empty('c_mazatlan', c);
    s.characters.chapitos_head!.purse = 5e6;
    s.outsiders.cjng!.envoys.chapitos_head = 1e9;
    s.outsiders.cdg!.envoys.chapitos_head = 1e9;
    s = run(s, 48, c);
    expect(Object.values(s.crews).some((x) => x.owner === 'chapitos_head' && x.hired?.kind === 'contingent')).toBe(true);
  });
});
