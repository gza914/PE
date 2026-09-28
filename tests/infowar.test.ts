import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import { Intel } from '../src/sim/ai/intel';
import { newContext } from '../src/sim/context';
import { newGame } from '../src/sim/newGame';
import { watchersOf } from '../src/sim/network';
import { opinionOf } from '../src/sim/opinion';
import type { GameState } from '../src/sim/state';
import { runInfowarDaily } from '../src/sim/systems/infowar';
import { runSchemesDaily } from '../src/sim/systems/schemes';
import { tick } from '../src/sim/tick';
import { addCrew, noAi, noBreakdowns, tuned } from './helpers';

const ic = (mut: (t: Content['tuning']) => void = () => {}) =>
  tuned((t) => {
    noAi(t);
    noBreakdowns(t);
    t.state.enabled = false;
    t.events.playerWeeklyCap = 0;
    mut(t);
  });
const c = ic();

function game(content: Content = c, playerId = 'c_mazatlan'): GameState {
  const s = newGame(content, { seed: 5, playerId });
  for (const id of Object.keys(s.crews)) delete s.crews[id];
  return s;
}

describe('messages', () => {
  it('a narcomanta naming a rival raises fear and his anger', () => {
    let s = game();
    const fear = s.characters.c_mazatlan!.fear;
    s = tick(s, [{ type: 'narcomanta', issuer: 'c_mazatlan', node: 'mazatlan', target: 'm_rosario' }], c).state;
    expect(s.characters.c_mazatlan!.fear).toBeGreaterThan(fear);
    expect(opinionOf(s, c, 'm_rosario', 'c_mazatlan')).toBeLessThan(opinionOf(game(), c, 'm_rosario', 'c_mazatlan'));
    expect(s.feed.some((f) => f.text.startsWith('A banner in Mazatlán'))).toBe(true);
    expect(tick(s, [{ type: 'narcomanta', issuer: 'c_mazatlan', node: 'el_rosario' }], c).rejected[0]?.reason).toMatch(/people in it/);
  });

  it('a rally video lifts your side; credibility scales it', () => {
    const run = (cred: number) => {
      let s = game();
      addCrew(s, 'own', 'c_la_tuna', 'la_tuna', { morale: 50 });
      s.characters.c_mazatlan!.credibility = cred;
      s = tick(s, [{ type: 'video', issuer: 'c_mazatlan', tone: 'rally' }], c).state;
      return s.crews.own!.morale - 50;
    };
    expect(run(80)).toBeGreaterThan(run(10));
    expect(run(10)).toBeGreaterThan(0);
  });

  it('false claims can be exposed, and exposure costs credibility', () => {
    const sharp = ic((t) => {
      t.infowar.claim.exposureBaseChance = 1;
    });
    let s = game(sharp);
    s = tick(s, [{ type: 'social_claim', issuer: 'c_mazatlan', claim: 'victory', against: 'mayos' }], sharp).state;
    expect(s.publicClaims[0]!.isFalse).toBe(true);
    const cred = s.characters.c_mazatlan!.credibility;
    runInfowarDaily(newContext(s, sharp));
    expect(s.publicClaims[0]!.exposed).toBe(true);
    expect(s.characters.c_mazatlan!.credibility).toBe(cred - sharp.tuning.infowar.claim.credibilityLoss);
  });

  it('a corrido builds respect day by day', () => {
    let s = game();
    s = tick(s, [{ type: 'commission_corrido', issuer: 'c_mazatlan' }], c).state;
    const r = s.characters.c_mazatlan!.respect;
    runInfowarDaily(newContext(s, c));
    expect(s.characters.c_mazatlan!.respect).toBe(r + c.tuning.infowar.corrido.respectPerDay);
  });

  it('a show of force tells everyone where your crews are', () => {
    let s = game();
    addCrew(s, 'p', 'c_mazatlan', 'mazatlan', { men: 30 });
    s = tick(s, [{ type: 'show_of_force', issuer: 'c_mazatlan', node: 'mazatlan' }], c).state;
    expect(s.reports.some((r) => r.network === 'mayos' && r.crew === 'p' && r.confidence === 'confirmed')).toBe(true);
  });
});

describe('planted rumors', () => {
  it('a fake weakness makes the rival believe a plaza is barely guarded', () => {
    let s = game();
    addCrew(s, 'g', 'c_mazatlan', 'la_noria', { men: 30 });
    s = tick(s, [{ type: 'plant_rumor', issuer: 'c_mazatlan', network: 'mayos', kind: 'fake_weakness', node: 'la_noria' }], c).state;
    const est = new Intel(s, c).defense('mayos', 'la_noria');
    expect(est.known).toBe(true);
    expect(est.men).toBe(c.tuning.infowar.rumor.fakeGarrisonMen);
  });

  it('a fake convoy shows up on a road in the rival’s intel', () => {
    let s = game();
    s = tick(s, [{ type: 'plant_rumor', issuer: 'c_mazatlan', network: 'mayos', kind: 'fake_convoy' }], c).state;
    const r = s.reports.find((x) => x.network === 'mayos' && x.planted)!;
    expect(r.where.kind).toBe('road');
    expect(r.men).toBe(c.tuning.infowar.rumor.fakeConvoyMen);
  });

  it('discovered rumors vanish from the target’s intel and cost credibility', () => {
    const sharp = ic((t) => (t.infowar.rumor.discoveryBaseChance = 1));
    let s = game(sharp);
    s = tick(s, [{ type: 'plant_rumor', issuer: 'c_mazatlan', network: 'mayos', kind: 'fake_convoy' }], sharp).state;
    const cred = s.characters.c_mazatlan!.credibility;
    runInfowarDaily(newContext(s, sharp));
    expect(s.reports.some((x) => x.planted)).toBe(false);
    expect(s.characters.c_mazatlan!.credibility).toBe(cred - sharp.tuning.infowar.rumor.credibilityLoss);
    expect(opinionOf(s, sharp, 'mayos_head', 'c_mazatlan')).toBeLessThan(0);
  });

  it('a fake betrayal can get a paranoid head to purge his own man', () => {
    // The Mayos head is Paranoico: the rumor reaches his desk as a decision.
    const aiEvents = ic((t) => (t.ai.layers.events = true));
    let s = game(aiEvents, 'c_mazatlan');
    s = tick(s, [{ type: 'plant_rumor', issuer: 'c_mazatlan', network: 'mayos', kind: 'fake_betrayal', subject: 'm_rosario' }], aiEvents).state;
    expect(s.eventLog.some((e) => e.event === 'rumor_betrayal' && e.decider === 'mayos_head' && e.scope === 'm_rosario')).toBe(true);
    expect(opinionOf(s, aiEvents, 'mayos_head', 'm_rosario')).toBeLessThan(opinionOf(game(aiEvents), aiEvents, 'mayos_head', 'm_rosario'));
  });
});

describe('schemes', () => {
  const fast = (mut: (t: Content['tuning']) => void = () => {}) =>
    ic((t) => {
      for (const k of Object.values(t.schemes.types)) {
        k.base = 200;
        k.discoveryBase = 0;
        k.discoveryPerAstucia = 0;
        k.successBase = 1;
      }
      mut(t);
    });

  it('buying a plaza’s halcones sends its sightings to you', () => {
    const f = fast();
    let s = game(f);
    s = tick(s, [{ type: 'start_scheme', issuer: 'c_mazatlan', scheme: 'buy_halcones', target: 'el_rosario' }], f).state;
    runSchemesDaily(newContext(s, f));
    expect(s.nodes.el_rosario!.halconesBoughtBy).toBe('chapitos');
    expect(watchersOf(s, f, 'el_rosario')[0]!.network).toBe('chapitos');
  });

  it('an assassination kills, and his heir takes over', () => {
    const f = fast((t) => (t.schemes.assassinateSecurityPerCrew = 0));
    let s = game(f);
    s = tick(s, [{ type: 'start_scheme', issuer: 'c_mazatlan', scheme: 'assassinate', target: 'm_rosario' }], f).state;
    runSchemesDaily(newContext(s, f));
    expect(s.characters.m_rosario!.status).toBe('dead');
    expect(s.nodes.el_rosario!.owner).not.toBe('m_rosario');
  });

  it('a flipped lieutenant brings his plazas to your side', () => {
    const f = fast();
    let s = game(f);
    s = tick(s, [{ type: 'start_scheme', issuer: 'c_mazatlan', scheme: 'flip', target: 'm_rosario' }], f).state;
    runSchemesDaily(newContext(s, f));
    expect(s.characters.m_rosario!.faction).toBe('chapitos');
    expect(opinionOf(s, f, 'mayos_head', 'm_rosario')).toBeLessThanOrEqual(f.tuning.diplomacy.traitorOpinion + 20);
  });

  it('discovery ends a scheme and names the schemer', () => {
    const f = ic((t) => (t.schemes.types.assassinate.discoveryBase = 1));
    let s = game(f);
    s = tick(s, [{ type: 'start_scheme', issuer: 'c_mazatlan', scheme: 'assassinate', target: 'm_rosario' }], f).state;
    runSchemesDaily(newContext(s, f));
    expect(s.schemes).toEqual([]);
    expect(s.characters.m_rosario!.status).toBe('free');
    expect(opinionOf(s, f, 'm_rosario', 'c_mazatlan')).toBeLessThan(f.tuning.schemes.discoveredOpinion / 2);
  });

  it('schemes are capped and validated', () => {
    let s = game();
    const r1 = tick(s, [{ type: 'start_scheme', issuer: 'c_mazatlan', scheme: 'flip', target: 'c_la_tuna' }], c);
    expect(r1.rejected[0]?.reason).toMatch(/other side/);
    s = tick(s, [
      { type: 'start_scheme', issuer: 'c_mazatlan', scheme: 'frame', target: 'm_rosario' },
      { type: 'start_scheme', issuer: 'c_mazatlan', scheme: 'leak_location', target: 'm_escuinapa' },
    ], c).state;
    expect(tick(s, [{ type: 'start_scheme', issuer: 'c_mazatlan', scheme: 'frame', target: 'm_escuinapa' }], c).rejected[0]?.reason).toMatch(/at most/);
  });
});
