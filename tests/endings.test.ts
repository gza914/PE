import { describe, expect, it } from 'vitest';
import { newContext } from '../src/sim/context';
import { newGame } from '../src/sim/newGame';
import { addOpinion, opinionBreakdown, opinionOf, pruneOpinions } from '../src/sim/opinion';
import type { GameState } from '../src/sim/state';
import { killCharacter } from '../src/sim/systems/characters';
import { territoryShares } from '../src/sim/systems/economy';
import { scorePlayer } from '../src/sim/systems/endings';
import { tick } from '../src/sim/tick';
import { calm } from './helpers';

function runTo(s: GameState, hour: number): GameState {
  while (s.hour < hour && !s.ended) s = tick(s, [], calm).state;
  return s;
}

describe('opinion', () => {
  it('sums relationship bases, shared faction, and decaying modifiers', () => {
    const s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    // La Morena and La Güera are sisters on opposite sides.
    expect(opinionOf(s, calm, 'c_tepuche', 'm_navolato')).toBe(calm.tuning.characters.relationOpinion.sibling);
    expect(opinionOf(s, calm, 'c_la_tuna', 'chapitos_head')).toBe(calm.tuning.characters.sharedFactionOpinion);
    addOpinion(s, calm, 'c_la_tuna', 'chapitos_head', 'helped_defend', 30, 60);
    expect(opinionOf(s, calm, 'c_la_tuna', 'chapitos_head')).toBe(40);
    s.hour += 30 * 24;
    expect(opinionOf(s, calm, 'c_la_tuna', 'chapitos_head')).toBeCloseTo(10 + 30 * (1 - 30 / (60 * 2)), 5);
    expect(opinionBreakdown(s, calm, 'c_la_tuna', 'chapitos_head').map((l) => l.key)).toEqual(['same_faction', 'helped_defend']);
  });

  it('Leal characters forget slowly; Vengativo ones never forget a slight', () => {
    const s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    addOpinion(s, calm, 'c_la_tuna', 'c_mazatlan', 'x', -20, 30);
    expect(s.characters.c_la_tuna!.opinions.c_mazatlan![0]!.decayDays).toBe(60);
    addOpinion(s, calm, 'm_guasave', 'c_mazatlan', 'x', -20, 30);
    expect(s.characters.m_guasave!.opinions.c_mazatlan![0]!.decayDays).toBeNull();
  });

  it('decayed modifiers are pruned', () => {
    const s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    addOpinion(s, calm, 'c_mazatlan', 'c_cosala', 'x', 10, 1);
    s.hour += 25;
    pruneOpinions(s);
    expect(s.characters.c_mazatlan!.opinions.c_cosala).toBeUndefined();
  });
});

describe('endings', () => {
  it('shares of the map add up and start roughly even', () => {
    const s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    const shares = territoryShares(s, calm);
    expect((shares.get('chapitos') ?? 0) + (shares.get('mayos') ?? 0)).toBeLessThanOrEqual(1);
    expect(Math.abs((shares.get('chapitos') ?? 0) - (shares.get('mayos') ?? 0))).toBeLessThan(0.1);
  });

  it('territorial defeat: under the defeat share of the map, towns and hills, for long enough', () => {
    const days = calm.tuning.endings.territorialDefeatDays;
    let s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    for (const n of Object.values(s.nodes)) if (n.owner && s.characters[n.owner]!.faction === 'mayos' && n.id !== 'eldorado') n.owner = 'chapitos_head';
    for (const [id, z] of Object.entries(s.countryside)) if (id !== 'eldorado') s.countryside[id] = z.mayos ? { chapitos: 60 } : z;
    for (const c of Object.values(s.colonias)) c.control = 100;
    s = runTo(s, (days - 1) * 24);
    expect(s.ended).toBeNull();
    s = runTo(s, (days + 1) * 24);
    expect(s.ended?.reason).toBe('territorial_defeat');
    expect(s.ended?.winner).toBe('chapitos');
  });

  it('faction collapse: a dead head with no one stepping up in time', () => {
    const c = structuredClone(calm);
    c.tuning.endings.successionChancePerDay = 0;
    let s = newGame(c, { seed: 1, playerId: 'c_mazatlan' });
    // Killing the head hands command to the next free senior member...
    killCharacter(newContext(s, c), 'mayos_head');
    expect(s.factions.mayos!.head).toBe('m_culiacan_sur');
    // ...so to collapse, the faction must be left with no head at all.
    s.factions.mayos!.head = null;
    while (s.hour < 9 * 24 && !s.ended) s = tick(s, [], c).state;
    expect(s.ended?.reason).toBe('faction_collapse');
    expect(s.ended?.winner).toBe('chapitos');
  });

  it('a captured head does not collapse the faction while others remain', () => {
    let s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    s.characters.mayos_head!.status = 'captured';
    s.characters.mayos_head!.captor = 'chapitos_head';
    s.characters.mayos_head!.statusSince = 0;
    s = runTo(s, 8 * 24);
    expect(s.ended).toBeNull();
  });

  it('negotiated truce: both factions exhausted for 14 days', () => {
    let s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    for (let d = 0; d < 16 && !s.ended; d++) {
      s.factions.chapitos!.exhaustion = 90;
      s.factions.mayos!.exhaustion = 90;
      s = runTo(s, s.hour + 24);
    }
    expect(s.ended?.reason).toBe('negotiated_truce');
  });

  it('a player who heads a faction must accept the truce', () => {
    let s = newGame(calm, { seed: 1, playerId: 'chapitos_head' });
    for (let d = 0; d < 16; d++) {
      s.factions.chapitos!.exhaustion = 90;
      s.factions.mayos!.exhaustion = 90;
      s = runTo(s, s.hour + 24);
    }
    expect(s.ended).toBeNull();
    expect(s.truceOffered).toBe(true);
    const r = tick(s, [{ type: 'accept_truce', issuer: 'chapitos_head' }], calm);
    expect(r.rejected).toEqual([]);
    expect(r.state.ended?.reason).toBe('negotiated_truce');
  });

  it('scores improvement over the start, with titles', () => {
    const s = newGame(calm, { seed: 1, playerId: 'c_mazatlan' });
    const even = scorePlayer(s, calm, null);
    expect(even.score.total).toBeCloseTo(100, 0);
    expect(even.title).toBe('survivor');
    // Take every Mayos plaza and win: El Patrón.
    for (const n of Object.values(s.nodes)) if (n.owner && s.characters[n.owner]!.faction === 'mayos') n.owner = 'c_mazatlan';
    s.nodes.mazatlan!.stash *= 3;
    const big = scorePlayer(s, calm, 'chapitos');
    expect(big.score.total).toBeGreaterThan(calm.tuning.endings.patronMinScore);
    expect(big.title).toBe('el_patron');
    s.characters.c_mazatlan!.status = 'dead';
    expect(scorePlayer(s, calm, 'chapitos').score.fate).toBe(calm.tuning.endings.fateMultipliers.deadOrExtradited);
  });
});
