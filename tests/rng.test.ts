import { describe, expect, it } from 'vitest';
import { rand, randInt, seedRng } from '../src/sim/rng';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = seedRng(42);
    const b = seedRng(42);
    const xs = Array.from({ length: 100 }, () => rand(a));
    const ys = Array.from({ length: 100 }, () => rand(b));
    expect(xs).toEqual(ys);
  });

  it('differs across seeds', () => {
    expect(rand(seedRng(1))).not.toEqual(rand(seedRng(2)));
  });

  it('survives a JSON round-trip mid-stream', () => {
    const a = seedRng(7);
    for (let i = 0; i < 10; i++) rand(a);
    const b = JSON.parse(JSON.stringify(a));
    expect(Array.from({ length: 20 }, () => rand(a))).toEqual(Array.from({ length: 20 }, () => rand(b)));
  });

  it('stays in range', () => {
    const s = seedRng(3);
    for (let i = 0; i < 10_000; i++) {
      const x = rand(s);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = randInt(s, 1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});
