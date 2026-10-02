/* Consigliere engine, JavaScript mirror of consigliere/engine for the web build.
 *
 * The Python engine is the source of truth. This file mirrors its monthly tick
 * step for step, and uses a Mersenne Twister that reproduces Python's
 * random.Random exactly, so the same seed gives the same game in both.
 * tests/test_web_parity.py enforces that. New games are not built here: the build
 * script dumps the validated starting WorldState from Python.
 */
(function (root) {
  "use strict";

  // ---- Python-compatible random (MT19937, CPython's seeding and helpers) ----
  const N = 624, M = 397;

  function initGenrand(mt, s) {
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
    }
  }

  function seedKey(seed) {
    let n = Math.abs(Math.trunc(seed));
    if (n === 0) return [0];
    const key = [];
    while (n > 0) {
      key.push(n % 4294967296);
      n = Math.floor(n / 4294967296);
    }
    return key;
  }

  class GameRNG {
    constructor(seed) {
      this.mt = new Array(N);
      this.mti = N;
      const key = seedKey(seed);
      const mt = this.mt;
      initGenrand(mt, 19650218);
      let i = 1, j = 0;
      for (let k = Math.max(N, key.length); k > 0; k--) {
        mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
        i++; j++;
        if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
        if (j >= key.length) j = 0;
      }
      for (let k = N - 1; k > 0; k--) {
        mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
        i++;
        if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      }
      mt[0] = 0x80000000;
    }

    uint32() {
      const mt = this.mt;
      let y;
      if (this.mti >= N) {
        let kk = 0;
        for (; kk < N - M; kk++) {
          y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
          mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        }
        for (; kk < N - 1; kk++) {
          y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
          mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        }
        y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
        mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        this.mti = 0;
      }
      y = mt[this.mti++];
      y ^= y >>> 11;
      y ^= (y << 7) & 0x9d2c5680;
      y ^= (y << 15) & 0xefc60000;
      y ^= y >>> 18;
      return y >>> 0;
    }

    random() {
      const a = this.uint32() >>> 5, b = this.uint32() >>> 6;
      return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
    }

    getrandbits(k) { return this.uint32() >>> (32 - k); }

    randbelow(n) {
      const k = Math.floor(Math.log2(n)) + 1; // n.bit_length()
      let r = this.getrandbits(k);
      while (r >= n) r = this.getrandbits(k);
      return r;
    }

    uniform(low, high) { return low + (high - low) * this.random(); }
    randint(low, high) { return low + this.randbelow(high - low + 1); }
    chance(p) { return this.random() < p; }
    choice(items) { return items[this.randbelow(items.length)]; }

    roundStochastic(value) {
      const whole = Math.floor(value);
      return whole + (this.random() < value - whole ? 1 : 0);
    }

    getState() { return { mt: this.mt.slice(), mti: this.mti }; }

    static fromState(state) {
      const rng = new GameRNG(0);
      rng.mt = state.mt.slice();
      rng.mti = state.mti;
      return rng;
    }
  }

  // ---- Python numeric helpers ----
  function pyRound(x) { // round half to even, like Python's round()
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
  }
  function clamp(value, low = 0, high = 100) { return Math.max(low, Math.min(high, value)); }
  function sum(xs) { let s = 0; for (const x of xs) s += x; return s; }

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  function monthLabel(month) { return `${MONTHS[month % 12]} ${1958 + Math.floor(month / 12)}`; }

  // ---- state helpers ----
  function player(state) { return state.characters[state.player_id]; }
  function playerFamily(state) { return state.families[player(state).family_id]; }
  function members(state, familyId) { return state.families[familyId].member_ids.map((id) => state.characters[id]); }

  // ---- economy (engine/systems/economy.py) ----
  const UNATTENDED_YIELD = 0.3;

  function skimFraction(capo, econ, rng) {
    let tendency = (capo.stats.greed / 100) * (1 - capo.stats.loyalty / 100);
    tendency += sum(capo.traits.map((t) => econ.skim_trait_bonus[t] ?? 0.0));
    tendency = clamp(tendency, 0, 1);
    const wobble = 1 + rng.uniform(-econ.skim_noise, econ.skim_noise);
    return clamp(econ.max_skim * tendency * wobble, 0, econ.max_skim);
  }

  function collect(racket, capo, econ, rng) {
    const swing = 1 + rng.uniform(-econ.income_variance, econ.income_variance);
    if (!capo || !capo.alive) return [pyRound(racket.income * swing * UNATTENDED_YIELD), 0];
    const competence = econ.competence_floor + 2 * (1 - econ.competence_floor) * capo.stats.competence / 100;
    const gross = racket.income * swing * competence;
    const owed = pyRound(gross * (1 - econ.capo_share));
    const skim = pyRound(owed * skimFraction(capo, econ, rng));
    return [owed - skim, skim];
  }

  function missStipend(state, family, bal) {
    for (const member of members(state, family.id)) {
      if (member.id !== family.don_id) {
        member.memory.push({
          event_id: "stipend_missed", about_id: family.id, month: state.month,
          weight: bal.stipends.missed_memory_weight, decay_rate: bal.stipends.missed_decay_rate,
        });
      }
    }
  }

  function runFamily(state, family, rng, bal) {
    const entry = { month: state.month, kickups: [], expenses: [], treasury_start: family.treasury, treasury_end: family.treasury };
    for (const racket of Object.values(state.rackets)) {
      if (racket.family_id !== family.id) continue;
      const capo = racket.capo_id ? state.characters[racket.capo_id] : null;
      const [kickup, skim] = collect(racket, capo, bal.economy, rng);
      if (capo && capo.alive) {
        capo.hidden.stash += skim;
        entry.kickups.push({ label: `${racket.name} (${capo.name})`, amount: kickup, note: "" });
      } else {
        entry.kickups.push({ label: racket.name, amount: kickup, note: "unattended" });
      }
      family.treasury += kickup;
    }
    for (const expense of family.expenses) {
      if (family.treasury >= expense.amount) {
        family.treasury -= expense.amount;
        entry.expenses.push({ label: expense.label, amount: expense.amount, note: "" });
      } else {
        entry.expenses.push({ label: expense.label, amount: expense.amount, note: "unpaid" });
        if (expense.stipend) missStipend(state, family, bal);
      }
    }
    entry.treasury_end = family.treasury;
    return entry;
  }

  function economy(state, rng, bal) {
    const playerFamilyId = player(state).family_id;
    for (const family of Object.values(state.families)) {
      const entry = runFamily(state, family, rng, bal);
      if (family.id === playerFamilyId) state.knowledge.ledger.push(entry);
    }
  }

  // ---- characters (engine/systems/characters.py) ----
  function decayMemories(character, forgetBelow) {
    for (const m of character.memory) m.weight *= 1 - m.decay_rate;
    character.memory = character.memory.filter((m) => Math.abs(m.weight) >= forgetBelow);
  }

  function loyaltyTarget(character, family, don, lb) {
    let target = lb.base;
    target += (don.stats.respect - 50) * lb.don_respect_weight;
    target += (family.cohesion - 50) * lb.cohesion_weight;
    target += sum(character.traits.map((t) => lb.trait_targets[t] ?? 0.0));
    const remembered = sum(character.memory.filter((m) => m.about_id === family.id || m.about_id === don.id).map((m) => m.weight));
    target += clamp(remembered, -lb.memory_cap, lb.memory_cap);
    return clamp(target);
  }

  function driftFamily(state, family, rng, lb) {
    const don = state.characters[family.don_id];
    const crew = members(state, family.id).filter((m) => m.alive && m.id !== family.don_id && m.id !== state.player_id);
    for (const member of crew) {
      const target = loyaltyTarget(member, family, don, lb);
      const delta = (target - member.stats.loyalty) * lb.drift_rate + rng.uniform(-lb.noise, lb.noise);
      member.stats.loyalty = Math.trunc(clamp(member.stats.loyalty + rng.roundStochastic(delta)));
    }
    if (crew.length) {
      const mean = sum(crew.map((m) => m.stats.loyalty)) / crew.length;
      const shift = (mean - family.cohesion) * lb.cohesion_drift_rate;
      family.cohesion = Math.trunc(clamp(family.cohesion + rng.roundStochastic(shift)));
    }
  }

  function characters(state, rng, bal) {
    for (const c of Object.values(state.characters)) decayMemories(c, bal.loyalty.forget_below);
    for (const family of Object.values(state.families)) driftFamily(state, family, rng, bal.loyalty);
  }

  // ---- observation (engine/systems/observation.py) ----
  function bandFor(obs, loyalty) {
    return obs.loyalty_bands.slice().sort((a, b) => b.min - a.min).find((b) => loyalty >= b.min);
  }

  function watched(state) {
    const family = playerFamily(state);
    return members(state, family.id).filter((m) => m.alive && m.id !== family.don_id && m.id !== state.player_id);
  }

  function observation(state, rng, bal, obs) {
    const ob = bal.observation;
    for (const member of watched(state)) {
      const band = bandFor(obs, member.stats.loyalty);
      if (state.knowledge.impressions[member.id] === band.id) continue;
      const notice = ob.base_notice + ob.indiscretion_weight * (100 - member.stats.discretion) / 100;
      if (!rng.chance(notice)) continue;
      state.knowledge.impressions[member.id] = band.id;
      state.knowledge.reports.push({
        id: `obs-${state.month}-${member.id}`, subject_id: member.id,
        claim: rng.choice(band.lines).split("{name}").join(member.name),
        source_id: state.player_id, month: state.month, confidence: ob.confidence,
      });
    }
  }

  // ---- turn (engine/turn.py) ----
  function tick(state, rng, content) {
    economy(state, rng, content.balance);
    characters(state, rng, content.balance);
    observation(state, rng, content.balance, content.observations);
    state.month += 1;
  }

  function newGame(content, seed, scenario = "default") {
    const state = JSON.parse(JSON.stringify(content.scenarios[scenario]));
    state.seed = seed;
    return { state, rng: new GameRNG(seed) };
  }

  const api = { GameRNG, pyRound, monthLabel, player, playerFamily, members, bandFor, tick, newGame };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ConsigliereEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
