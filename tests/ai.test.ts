import { describe, expect, it } from 'vitest';
import type { Content } from '../src/data/content';
import { Intel } from '../src/sim/ai/intel';
import { runAi } from '../src/sim/ai';
import { attackRatio, personalCrew, pickOffensive } from '../src/sim/ai/strategic';
import { newContext } from '../src/sim/context';
import { startBattle } from '../src/sim/systems/combat';
import { checkInvariants } from '../src/sim/invariants';
import { newGame, newTransit } from '../src/sim/newGame';
import { opinionOf } from '../src/sim/opinion';
import type { CrewState, GameState, Report } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { addCrew, noAi, noWorld, tuned } from './helpers';

type Layers = Content['tuning']['ai']['layers'];
const only = (on: Partial<Layers>) =>
  tuned((t) => {
    noAi(t);
    noWorld(t);
    t.roads.brecha.breakdownChancePerSegment = 0;
    t.ai.layers = { ...t.ai.layers, ...on };
    // Mechanics tests need offensives to happen; campaign pacing is the balance runner's job.
    t.ai.strategic.attackForceRatio = 3;
  });

function cleared(c: Content, playerId = 'c_mazatlan', seed = 1): GameState {
  const s = newGame(c, { seed, playerId });
  for (const id of Object.keys(s.crews)) delete s.crews[id];
  return s;
}

function sighting(s: GameState, network: string, crew: CrewState, source: Report['source'] = 'halcon', hoursAgo = 0): void {
  s.reports.push({
    id: `rep_t${s.reports.length}`,
    network,
    crew: crew.id,
    owner: crew.owner,
    men: crew.men,
    low: crew.men,
    high: crew.men,
    vehicles: { pickup: crew.vehicles.pickup },
    where: structuredClone(crew.location),
    roadType: null,
    hour: s.hour - hoursAgo,
    confidence: source === 'halcon' ? 'estimated' : 'confirmed',
    source,
    planted: false,
  });
}

function runTo(s: GameState, c: Content, hour: number): GameState {
  while (s.hour < hour && !s.ended) s = tick(s, [], c).state;
  return s;
}

describe('intel: the AI knows only what its network reported', () => {
  const c = only({});
  it('with no reports it assumes a typical garrison', () => {
    const s = cleared(c);
    const est = new Intel(s, c).defense('chapitos', 'guasave');
    expect(est.known).toBe(false);
    expect(est.men).toBe(c.tuning.ai.strategic.priorGarrisonMenByType.town);
  });

  it('a few halcón sightings are a floor, not the whole garrison', () => {
    const s = cleared(c);
    const small = addCrew(s, 'g', 'm_guasave', 'guasave', { men: 4 });
    sighting(s, 'chapitos', small);
    expect(new Intel(s, c).defense('chapitos', 'guasave').men).toBe(c.tuning.ai.strategic.priorGarrisonMenByType.town);
  });

  it('someone inside the plaza sees it all', () => {
    const s = cleared(c);
    const small = addCrew(s, 'g', 'm_guasave', 'guasave', { men: 4 });
    sighting(s, 'chapitos', small, 'presence');
    const est = new Intel(s, c).defense('chapitos', 'guasave');
    expect(est.known).toBe(true);
    expect(est.men).toBe(4);
  });

  it('a scout lying low in a rival plaza files presence reports without being seen', () => {
    const cc = only({});
    let s = cleared(cc);
    addCrew(s, 'g', 'm_guasave', 'guasave', { men: 18 });
    addCrew(s, 'scout', 'c_guamuchil', 'guasave', { men: 4, order: { type: 'lie_low', since: 0 } });
    s = tick(s, [], cc).state;
    expect(s.reports.some((r) => r.network === 'chapitos' && r.crew === 'g' && r.source === 'presence')).toBe(true);
    expect(s.reports.some((r) => r.network === 'mayos' && r.crew === 'scout')).toBe(false);
  });

  it('the AI does not react to crews it has not seen', () => {
    const c2 = only({ strategic: true, operational: true, tactical: true });
    const base = newGame(c2, { seed: 5, playerId: 'c_mazatlan' });
    base.hour = 6 * 24 + c2.tuning.ai.strategic.hourOfDay - 1;
    const hidden = structuredClone(base);
    // A huge Mayos army nobody has reported, parked in a Mayos plaza.
    addCrew(hidden, 'ghost', 'mayos_head', 'eldorado', { men: 40, skill: 5, gear: 5, vehicles: { pickup: 10, suv: 0, motorcycle: 0, armored: 3 } });
    const a = runAi(newContext(structuredClone(base), c2)).filter((x) => x.issuer.startsWith('c') || x.issuer === 'chapitos_head');
    const b = runAi(newContext(structuredClone(hidden), c2)).filter((x) => x.issuer.startsWith('c') || x.issuer === 'chapitos_head');
    expect(b).toEqual(a);
  });
});

describe('strategic: faction heads', () => {
  it('a rested, supplied faction launches a coordinated offensive after the opening days', () => {
    const c = only({ strategic: true });
    let s = newGame(c, { seed: 2, playerId: 'm_la_cruz' });
    s = runTo(s, c, c.tuning.ai.strategic.firstOffensiveDay * 24 + c.tuning.ai.strategic.hourOfDay + 1);
    const o = s.offensives[0];
    expect(o).toBeDefined();
    expect(s.factions[o!.faction]!.warPlan.mode).toBe('attack');
    // The head's own crews got raid orders; everyone else got requests, all for the same hour.
    const reqs = s.requests.filter((r) => r.offensive === o!.id);
    for (const r of reqs) expect(r.arriveBy).toBe(o!.arriveAt);
    const raiders = Object.values(s.crews).filter((x) => x.order.type === 'raid' && x.order.target === o!.target);
    for (const x of raiders) expect(x.order.type === 'raid' && x.order.arriveAt).toBe(o!.arriveAt);
    expect(reqs.length + raiders.length).toBeGreaterThan(0);
  });

  it('no offensive before the first offensive day', () => {
    const c = only({ strategic: true });
    let s = newGame(c, { seed: 2, playerId: 'm_la_cruz' });
    s = runTo(s, c, c.tuning.ai.strategic.firstOffensiveDay * 24 - 1);
    expect(s.offensives).toEqual([]);
  });

  it('heads never send the crew they ride with', () => {
    const c = only({ strategic: true });
    let s = newGame(c, { seed: 2, playerId: 'm_la_cruz' });
    const seen = new Set<string>();
    while (s.hour < 20 * 24) {
      s = tick(s, [], c).state;
      for (const o of s.offensives) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        expect(o.crews).not.toContain(personalCrew(s, s.factions[o.faction]!.head!));
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('a head rides with one crew; the other crews they raised can go to war', () => {
    const c = tuned((t) => {
      noAi(t);
      noWorld(t);
      t.ai.strategic.attackForceRatio = 1;
      t.ai.strategic.lateAttackForceRatio = 1;
    });
    const s = cleared(c);
    addCrew(s, 'big', 'mayos_head', 'eldorado', { men: 40 });
    addCrew(s, 'extra', 'mayos_head', 'eldorado', { men: 30 });
    addCrew(s, 'guard', 'm_los_mochis', 'eldorado', { men: 35 });
    expect(personalCrew(s, 'mayos_head')).toBe('big');
    const plan = pickOffensive(newContext(s, c), new Intel(s, c), s.factions.mayos!);
    const sent = plan?.crews.map((x) => x.id) ?? [];
    expect(sent).toContain('extra');
    expect(sent).not.toContain('big');
  });

  it('the force margin eases as a long war drags on', () => {
    const t = only({}).tuning.ai.strategic;
    expect(attackRatio(t, 0)).toBe(t.attackForceRatio);
    expect(attackRatio(t, (t.lateWarStartDay + t.lateWarFullDay) / 2)).toBeCloseTo((t.attackForceRatio + t.lateAttackForceRatio) / 2, 9);
    expect(attackRatio(t, t.lateWarFullDay + 100)).toBe(t.lateAttackForceRatio);
  });

  describe('desperation lowers the margin', () => {
    const c = tuned((t) => {
      noAi(t);
      noWorld(t);
      t.ai.strategic.attackForceRatio = 10;
      t.ai.strategic.lateAttackForceRatio = 1;
      t.ai.strategic.lateWarStartDay = 1000;
      t.ai.strategic.lateWarFullDay = 1100;
    });
    const setup = () => {
      const s = cleared(c);
      addCrew(s, 'big', 'mayos_head', 'eldorado', { men: 40 });
      addCrew(s, 'extra', 'mayos_head', 'eldorado', { men: 30 });
      addCrew(s, 'guard', 'm_los_mochis', 'eldorado', { men: 35 });
      return s;
    };
    const pick = (s: GameState) => pickOffensive(newContext(s, c), new Intel(s, c), s.factions.mayos!);

    it('a comfortable faction waits for overwhelming odds', () => {
      expect(pick(setup())).toBeNull();
    });

    it('a plaza lost recently is worth retaking at worse odds', () => {
      const s = setup();
      s.factions.mayos!.warPlan.lost.push({ node: 'culiacancito', at: s.hour });
      expect(pick(s)?.target).toBe('culiacancito');
    });

    it('a faction losing the map attacks at worse odds', () => {
      const s = setup();
      for (const n of Object.values(s.nodes)) if (n.owner && s.characters[n.owner]!.faction === 'mayos' && n.id !== 'eldorado') n.owner = 'chapitos_head';
      expect(pick(s)).not.toBeNull();
    });
  });

  it('an exhausted faction regroups and calls off its offensive', () => {
    const c = only({ strategic: true });
    let s = newGame(c, { seed: 2, playerId: 'm_la_cruz' });
    s = runTo(s, c, c.tuning.ai.strategic.firstOffensiveDay * 24 + c.tuning.ai.strategic.hourOfDay + 1);
    const o = s.offensives[0]!;
    s.factions[o.faction]!.exhaustion = 90;
    s = runTo(s, c, s.hour + 24);
    expect(s.factions[o.faction]!.warPlan.mode).toBe('regroup');
    expect(s.offensives.find((x) => x.id === o.id)!.status).toBe('cancelled');
  });
});

describe('requests', () => {
  function withRequest(kind: 'levy' | 'defend' = 'levy') {
    const c = only({});
    const s = newGame(c, { seed: 1, playerId: 'c_mazatlan' });
    const ctx = newContext(s, c);
    s.requests.push({
      id: 'req_t',
      faction: 'chapitos',
      from: 'chapitos_head',
      to: 'c_mazatlan',
      kind,
      target: kind === 'defend' ? 'la_noria' : null,
      crews: [],
      amount: 50000,
      arriveBy: kind === 'defend' ? s.hour + 10 : null,
      offensive: null,
      createdAt: s.hour,
      respondBy: s.hour + 12,
      status: 'pending',
      resolvedAt: null,
    });
    return { c, s, ctx };
  }

  it('paying a levy moves the cash and pleases the head', () => {
    const { c, s } = withRequest('levy');
    const before = opinionOf(s, c, 'chapitos_head', 'c_mazatlan');
    const r = tick(s, [{ type: 'respond_request', issuer: 'c_mazatlan', request: 'req_t', accept: true }], c);
    expect(r.rejected).toEqual([]);
    expect(r.state.requests[0]!.status).toBe('fulfilled');
    expect(opinionOf(r.state, c, 'chapitos_head', 'c_mazatlan')).toBeGreaterThan(before);
  });

  it('refusing costs the head’s opinion; ignoring does too', () => {
    const a = withRequest('levy');
    const refused = tick(a.s, [{ type: 'respond_request', issuer: 'c_mazatlan', request: 'req_t', accept: false }], a.c).state;
    expect(opinionOf(refused, a.c, 'chapitos_head', 'c_mazatlan')).toBeLessThan(opinionOf(a.s, a.c, 'chapitos_head', 'c_mazatlan'));
    const b = withRequest('levy');
    const ignored = runTo(b.s, b.c, b.s.hour + 14);
    expect(ignored.requests[0]?.status ?? 'pruned').toMatch(/expired|pruned/);
    expect(opinionOf(ignored, b.c, 'chapitos_head', 'c_mazatlan')).toBeLessThan(opinionOf(b.s, b.c, 'chapitos_head', 'c_mazatlan'));
  });

  it('an accepted defend request is judged at its deadline', () => {
    const { c, s } = withRequest('defend');
    let x = tick(s, [{ type: 'respond_request', issuer: 'c_mazatlan', request: 'req_t', accept: true }], c).state;
    x = runTo(x, c, s.hour + 10 + c.tuning.ai.strategic.slackHours + 1);
    expect(x.requests[0]!.status).toMatch(/fulfilled|failed/);
  });
});

describe('operational: lieutenants', () => {
  it('a strong lieutenant raids a weak neighbor it has scouted', () => {
    const c = only({ operational: true });
    const s = cleared(c);
    s.hour = 5 * 24;
    addCrew(s, 'big', 'm_guasave', 'guasave', { men: 36, skill: 4, vehicles: { pickup: 9, suv: 0, motorcycle: 0, armored: 0 } });
    addCrew(s, 'home', 'm_guasave', 'guasave', { men: 12 });
    const weak = addCrew(s, 'weak', 'c_guamuchil', 'guamuchil', { men: 4, vehicles: { pickup: 1, suv: 0, motorcycle: 0, armored: 0 } });
    sighting(s, 'mayos', weak, 'presence');
    const x = runTo(s, c, s.hour + c.tuning.ai.operationalIntervalHours);
    // It keeps its biggest crew home on the front line and sends the other.
    expect(x.crews.big!.order.type).toBe('garrison');
    const home = x.crews.home!;
    expect(home.order.type === 'raid' ? home.order.target : home.location.kind === 'node' ? x.nodes[home.location.node]!.owner : null).toMatch(/guamuchil|m_guasave/);
  });

  it('a lieutenant sets an ambush on a road its halcones saw rivals use', () => {
    const c = only({ operational: true });
    const s = cleared(c);
    s.hour = 5 * 24;
    addCrew(s, 'a', 'm_la_cruz', 'la_cruz', { men: 12 });
    addCrew(s, 'b', 'm_la_cruz', 'la_cruz', { men: 12 });
    const rival = addCrew(s, 'r', 'c_mazatlan', 'mazatlan', {
      location: { kind: 'road', road: 'r_la_cruz_to_mazatlan', from: 'mazatlan', to: 'la_cruz', progressKm: 40 },
    });
    for (let i = 0; i < 3; i++) sighting(s, 'mayos', { ...rival, id: `r${i}` }, 'halcon', i);
    delete s.crews.r;
    const x = runTo(s, c, s.hour + c.tuning.ai.operationalIntervalHours);
    expect(['a', 'b'].some((id) => x.crews[id]!.order.type === 'ambush')).toBe(true);
  });

  it('crews idle in Culiacán get committed to a contested colonia', () => {
    const c = only({ operational: true });
    const s = cleared(c);
    s.hour = 5 * 24;
    addCrew(s, 'x', 'c_culiacan_norte', 'culiacan');
    const x = runTo(s, c, s.hour + c.tuning.ai.operationalIntervalHours);
    expect(x.crews.x!.colonia).not.toBeNull();
  });

  it('stale ambushes are recalled', () => {
    const c = only({ operational: true });
    let s = cleared(c);
    addCrew(s, 'x', 'm_la_cruz', 'la_cruz', {
      order: { type: 'ambush', road: 'r_la_cruz_to_mazatlan', atKm: 50, since: 0 },
      location: { kind: 'road', road: 'r_la_cruz_to_mazatlan', from: 'la_cruz', to: 'mazatlan', progressKm: 50 },
    });
    s.hour = c.tuning.ai.operational.ambushMaxHours + 1;
    s = runTo(s, c, s.hour + 7);
    expect(s.crews.x!.order.type).not.toBe('ambush');
  });

  it('a scout whose hiding place falls to its own side takes up the garrison', () => {
    const c = only({ operational: true });
    let s = cleared(c);
    addCrew(s, 'x', 'm_la_cruz', 'la_cruz', { order: { type: 'lie_low', since: 0 } });
    s = runTo(s, c, s.hour + 7);
    expect(s.crews.x!.order.type).toBe('garrison');
  });
});

describe('tactical: crew leaders in battle', () => {
  /** An AI crew (La Viuda's) facing the player's in Villa Unión, before any hour is fought. */
  function standoff(aiMen: number, foeMen: number, foeMorale = 70) {
    const c = only({ tactical: true });
    const s = cleared(c, 'c_mazatlan');
    addCrew(s, 'ai', 'm_villa_union', 'villa_union', { men: aiMen, vehicles: { pickup: 10, suv: 0, motorcycle: 0, armored: 0 } });
    addCrew(s, 'foe', 'c_mazatlan', 'villa_union', { men: foeMen, morale: foeMorale, vehicles: { pickup: 10, suv: 0, motorcycle: 0, armored: 0 }, order: { type: 'idle' } });
    const b = startBattle(newContext(s, c), { type: 'raid', attackers: ['foe'], defenders: ['ai'], where: { kind: 'node', node: 'villa_union' }, capture: true })!;
    return { c, s, b };
  }

  it('an AI force badly outgunned withdraws in good order', () => {
    const { c, s, b } = standoff(6, 40);
    expect(runAi(newContext(s, c)).some((x) => x.type === 'battle_withdraw' && x.battle === b.id && x.issuer === 'm_villa_union')).toBe(true);
  });

  it('an AI force at fair odds holds', () => {
    const { c, s } = standoff(20, 20);
    expect(runAi(newContext(s, c)).some((x) => x.type === 'battle_withdraw')).toBe(false);
  });

  it('an AI force takes a breaking enemy\u2019s surrender', () => {
    const { c, s, b } = standoff(20, 20, 10);
    expect(runAi(newContext(s, c)).some((x) => x.type === 'battle_accept_surrender' && x.battle === b.id && x.issuer === 'm_villa_union')).toBe(true);
  });

  it('it never makes battle decisions for the player', () => {
    const { c, s } = standoff(40, 6);
    expect(runAi(newContext(s, c)).some((x) => x.issuer === 'c_mazatlan')).toBe(false);
  });
});

describe('shadow: the AI and the State', () => {
  it('a lieutenant with a lab in a surge region bribes the army commander', () => {
    const c = only({ shadow: true });
    let s = newGame(c, { seed: 1, playerId: 'c_mazatlan' });
    s.regions.sur!.calentura = 70;
    s.nodes.el_rosario!.labs = 1;
    s.nodes.el_rosario!.stash = 1_000_000;
    s = runTo(s, c, 25);
    expect(s.regions.sur!.commanderBribedBy).toBe('mayos');
  });

  it('a quiet region gets no bribes', () => {
    const c = only({ shadow: true });
    let s = newGame(c, { seed: 1, playerId: 'c_mazatlan' });
    s.nodes.el_rosario!.labs = 1;
    s.nodes.el_rosario!.stash = 1_000_000;
    for (const r of Object.values(s.regions)) r.calentura = 0;
    s = runTo(s, c, 25);
    expect(Object.values(s.regions).every((r) => r.commanderBribedBy === null)).toBe(true);
  });
});

describe('autoplay', () => {
  it('the AI commands the player’s crews only on autoplay', () => {
    const c = only({ strategic: true, operational: true, tactical: true, economy: true, traffic: true });
    for (const autoplay of [false, true]) {
      let s = newGame(c, { seed: 3, playerId: 'm_guasave', autoplay });
      let issued = false;
      for (let h = 0; h < 10 * 24 && !issued; h++) {
        issued = runAi(newContext(s, c)).some((x) => x.issuer === 'm_guasave');
        s = tick(s, [], c).state;
      }
      expect(issued).toBe(autoplay);
    }
  });
});

describe('stability', () => {
  it('determinism: same seed, same full-AI war', () => {
    const c = only({ strategic: true, operational: true, tactical: true, economy: true, traffic: true });
    const run = () => {
      let s = newGame(c, { seed: 42, playerId: 'c_mazatlan', autoplay: true });
      for (let h = 0; h < 30 * 24; h++) s = tick(s, [], c).state;
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  }, 60000);

  it('invariants hold through full-AI campaigns', () => {
    const c = only({ strategic: true, operational: true, tactical: true, economy: true, traffic: true });
    for (const seed of [7, 8, 9]) {
      let s = newGame(c, { seed, playerId: 'c_mazatlan', autoplay: true, neutrals: seed === 9 ? ['m_angostura', 'c_cosala'] : [] });
      for (let d = 0; d < 60 && !s.ended; d++) {
        for (let h = 0; h < 24 && !s.ended; h++) s = tick(s, [], c).state;
        expect(checkInvariants(s, c), `seed ${seed} day ${d}`).toEqual([]);
      }
    }
  }, 120000);

  it('a save mid-war resumes identically', () => {
    const c = only({ strategic: true, operational: true, tactical: true, economy: true, traffic: true });
    let s = newGame(c, { seed: 11, playerId: 'c_mazatlan', autoplay: true });
    for (let h = 0; h < 12 * 24; h++) s = tick(s, [], c).state;
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    let a = s;
    let b = copy;
    for (let h = 0; h < 5 * 24; h++) {
      a = tick(a, [], c).state;
      b = tick(b, [], c).state;
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 60000);
});

void newTransit;
