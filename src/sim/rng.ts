/**
 * Deterministic, serializable PRNG (sfc32). The state is a plain object stored
 * inside GameState, so saving the game saves the RNG with it. Never use
 * Math.random() in the sim.
 */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export function seedRng(seed: number): RngState {
  // splitmix32 expands one seed into four well-mixed words.
  let x = seed >>> 0;
  const next = () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const s: RngState = { a: next(), b: next(), c: next(), d: next() };
  for (let i = 0; i < 12; i++) nextU32(s);
  return s;
}

/** Advances the state in place and returns a uint32. */
export function nextU32(s: RngState): number {
  const t = (((s.a + s.b) >>> 0) + s.d) >>> 0;
  s.d = (s.d + 1) >>> 0;
  s.a = (s.b ^ (s.b >>> 9)) >>> 0;
  s.b = (s.c + (s.c << 3)) >>> 0;
  s.c = ((s.c << 21) | (s.c >>> 11)) >>> 0;
  s.c = (s.c + t) >>> 0;
  return t;
}

/** Float in [0, 1). */
export function rand(s: RngState): number {
  return nextU32(s) / 4294967296;
}

/** Float in [min, max). */
export function randRange(s: RngState, min: number, max: number): number {
  return min + rand(s) * (max - min);
}

/** Integer in [min, max], inclusive. */
export function randInt(s: RngState, min: number, max: number): number {
  return min + Math.floor(rand(s) * (max - min + 1));
}

export function chance(s: RngState, p: number): boolean {
  return rand(s) < p;
}

export function pick<T>(s: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty array');
  return items[Math.floor(rand(s) * items.length)]!;
}
