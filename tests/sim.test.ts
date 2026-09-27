import { describe, expect, it } from 'vitest';
import { bundledContent } from '../src/data/bundled';
import { dayOf, formatDateTime, isNight, isPayrollHour, weekday } from '../src/sim/clock';
import { runHeadless } from '../src/sim/headless';
import { newGame } from '../src/sim/newGame';
import { parseSave, serializeSave } from '../src/sim/save';
import { tick } from '../src/sim/tick';

const content = bundledContent();
const opts = { seed: 1234, playerId: 'c_mazatlan' };

describe('newGame', () => {
  it('builds state from content', () => {
    const s = newGame(content, opts);
    expect(Object.keys(s.nodes)).toHaveLength(content.nodes.length);
    expect(Object.keys(s.characters)).toHaveLength(content.characters.length);
    const crewCount = content.characters.reduce((n, c) => n + c.crews.length, 0);
    expect(Object.keys(s.crews)).toHaveLength(crewCount);
    expect(s.hour).toBe(0);
  });

  it('rejects unknown or unplayable characters', () => {
    expect(() => newGame(content, { seed: 1, playerId: 'nobody' })).toThrow();
  });
});

describe('tick', () => {
  it('advances one hour and does not mutate its input', () => {
    const s0 = newGame(content, opts);
    const snapshot = JSON.stringify(s0);
    const { state: s1 } = tick(s0, [], content);
    expect(s1.hour).toBe(1);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it('is deterministic for the same seed and commands', () => {
    const run = () => {
      let s = newGame(content, opts);
      for (let h = 0; h < 24 * 14; h++) {
        const cmds = h === 5 ? [{ type: 'set_extortion_rate' as const, issuer: 'c_mazatlan', node: 'mazatlan', rate: 'high' as const }] : [];
        s = tick(s, cmds, content).state;
      }
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });

  it('applies valid commands and rejects invalid ones', () => {
    const s0 = newGame(content, opts);
    const { state, rejected } = tick(
      s0,
      [
        { type: 'set_extortion_rate', issuer: 'c_mazatlan', node: 'mazatlan', rate: 'brutal' },
        { type: 'set_extortion_rate', issuer: 'c_mazatlan', node: 'la_tuna', rate: 'brutal' },
        { type: 'declare_alignment', issuer: 'c_mazatlan', faction: null },
      ],
      content,
    );
    expect(state.nodes.mazatlan!.extortionRate).toBe('brutal');
    expect(state.nodes.la_tuna!.extortionRate).toBe('medium');
    expect(state.characters.c_mazatlan!.faction).toBeNull();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatch(/does not own/);
  });
});

describe('clock', () => {
  it('starts on the configured date', () => {
    // 2024-09-09 was a Monday.
    expect(weekday(0, content.tuning)).toBe(1);
    expect(formatDateTime(0, content.tuning)).toContain('2024');
  });

  it('knows night and payroll', () => {
    expect(isNight(22, content.tuning)).toBe(true);
    expect(isNight(12, content.tuning)).toBe(false);
    expect(isNight(5, content.tuning)).toBe(true);
    // First Sunday 00:00 is 6 days in.
    expect(isPayrollHour(6 * 24, content.tuning)).toBe(true);
    expect(isPayrollHour(5 * 24, content.tuning)).toBe(false);
  });
});

describe('save', () => {
  it('round-trips and continues identically', () => {
    let s = newGame(content, opts);
    for (let i = 0; i < 50; i++) s = tick(s, [], content).state;
    const loaded = parseSave(serializeSave(s));
    expect(loaded).toEqual(s);
    expect(JSON.stringify(tick(loaded, [], content).state)).toBe(JSON.stringify(tick(s, [], content).state));
  });

  it('rejects foreign files', () => {
    expect(() => parseSave('{"hello":1}')).toThrow(/not a Cartel Conquest save/);
  });
});

describe('headless campaign', () => {
  it('runs to the time cap', () => {
    const end = runHeadless(content, opts);
    expect(end.ended?.reason).toBe('time_cap');
    expect(dayOf(end.hour)).toBe(content.tuning.clock.maxDays);
  });
});
