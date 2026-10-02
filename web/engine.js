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

    weightedIndex(weights) {
      let r = this.random() * sum(weights);
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i;
      }
      return weights.length - 1;
    }

    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = this.randint(0, i);
        [items[i], items[j]] = [items[j], items[i]];
      }
    }

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

  function collect(racket, capo, econ, rng, rivalRun = false) {
    const swing = 1 + rng.uniform(-econ.income_variance, econ.income_variance);
    if (!capo || !capo.alive) {
      if (rivalRun) return [pyRound(racket.income * swing * (1 - econ.capo_share)), 0];
      return [pyRound(racket.income * swing * UNATTENDED_YIELD), 0];
    }
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
    const entry = { month: state.month, kickups: [], expenses: [], other: [], treasury_start: family.treasury, treasury_end: family.treasury };
    if (family.id === player(state).family_id && state.unbooked.length) {
      entry.other = state.unbooked;
      entry.treasury_start -= sum(state.unbooked.map((l) => l.amount));
      state.unbooked = [];
    }
    for (const racket of Object.values(state.rackets)) {
      if (racket.family_id !== family.id) continue;
      const capo = racket.capo_id ? state.characters[racket.capo_id] : null;
      const [kickup, skim] = collect(racket, capo, bal.economy, rng, family.id !== player(state).family_id);
      if (capo && capo.alive) {
        capo.hidden.stash += skim;
        entry.kickups.push({ label: `${racket.name} (${capo.name})`, amount: kickup, note: "", racket_id: racket.id });
      } else {
        entry.kickups.push({ label: racket.name, amount: kickup, note: "unattended", racket_id: racket.id });
      }
      family.treasury += kickup;
    }
    family.expenses = family.expenses.filter((e) => e.until === null || e.until === undefined || e.until >= state.month);
    for (const expense of family.expenses) {
      if (family.treasury >= expense.amount) {
        family.treasury -= expense.amount;
        entry.expenses.push({ label: expense.label, amount: expense.amount, note: "", racket_id: null });
      } else {
        entry.expenses.push({ label: expense.label, amount: expense.amount, note: "unpaid", racket_id: null });
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

  // ---- matters (engine/matters.py) ----
  const WAIT = "wait";
  const SECRET = "?";
  const STATS = ["loyalty", "fear", "respect", "competence", "greed", "discretion"];
  const HIDDEN = ["health", "stash", "birth_year", "debts"];
  const yearOf = (month) => 1958 + Math.floor(month / 12);

  function crew(state) {
    const family = playerFamily(state);
    return members(state, family.id).filter((m) => m.alive && m.id !== family.don_id && m.id !== state.player_id);
  }

  function resolveId(state, bindings, name, selfId) {
    if (name === "self") return selfId;
    if (name === "don") return playerFamily(state).don_id;
    if (name === "you") return state.player_id;
    return bindings[name];
  }

  function lookup(state, bindings, path, selfId) {
    if (typeof path !== "string") return path;
    const dot = path.indexOf(".");
    const head = dot < 0 ? path : path.slice(0, dot);
    const attr = dot < 0 ? "" : path.slice(dot + 1);
    const family = playerFamily(state);
    if (!attr) {
      const simple = {
        treasury: family.treasury, cohesion: family.cohesion, month: state.month, year: yearOf(state.month),
        dons_trust: state.standing.dons_trust, influence: state.standing.influence,
        exposure: state.standing.exposure, don_mood: state.don_mood,
        strength: family.strength, heat: family.heat, crew_size: crewSize(state),
      };
      return head in simple ? simple[head] : path;
    }
    if (head === "flag") return attr in state.flags ? 1 : 0;
    if (head === "secret") return bindings[SECRET + attr] === "yes" ? 1 : 0;
    const target = resolveId(state, bindings, head, selfId);
    if (target in state.characters) {
      const c = state.characters[target];
      if (STATS.includes(attr)) return c.stats[attr];
      if (HIDDEN.includes(attr)) return c.hidden[attr];
      if (attr === "age") return yearOf(state.month) - c.hidden.birth_year;
      if (attr === "rackets") return Object.values(state.rackets).filter((r) => r.capo_id === target).length;
      if (attr === "alive") return c.alive ? 1 : 0;
      if (attr === "allegiance") return c.hidden.allegiance;
      if (attr === "id") return c.id;
      if (attr === "heat") return pressure(state, target);
      if (attr === "investigation") return investigationStage(state, target);
    } else if (target in state.rackets) {
      const r = state.rackets[target];
      if (attr === "income" || attr === "heat") return r[attr];
      if (attr === "kind") return r.kind;
      if (attr === "unattended") return r.capo_id === null ? 1 : 0;
      if (attr === "ours") return r.family_id === family.id ? 1 : 0;
    } else if (target in state.families) {
      const f = state.families[target];
      if (["strength", "wealth", "cohesion", "heat", "treasury"].includes(attr)) return f[attr];
      const rivalry = state.rivalries[target];
      if (rivalry && ["stage", "tension", "war_months"].includes(attr)) return rivalry[attr];
    } else if (target in state.districts) {
      const d = state.districts[target];
      if (attr === "heat") return districtHeat(state, target);
      if (attr === "ours") return d.family_id === family.id ? 1 : 0;
    }
    throw new Error(`cannot resolve ${path}`);
  }

  function check(state, bindings, cond, selfId) {
    if (!Array.isArray(cond)) return cond.any.some((c) => check(state, bindings, c, selfId));
    const [left, op, right] = cond;
    if (op === "has" || op === "lacks") {
      const c = state.characters[resolveId(state, bindings, left, selfId)];
      const found = c.traits.includes(right) || c.hidden.vices.includes(right);
      return op === "has" ? found : !found;
    }
    const a = lookup(state, bindings, left, selfId);
    const b = lookup(state, bindings, right, selfId);
    switch (op) {
      case "<": return a < b;
      case "<=": return a <= b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "==": return a === b;
      default: return a !== b;
    }
  }

  function checkAll(state, bindings, conds, selfId) {
    return conds.every((c) => check(state, bindings, c, selfId));
  }

  const isRacketSlot = (slot) => Boolean(slot.racket) || slot.racket_of != null || slot.racket_not_of != null || slot.racket_in != null;
  const slotKind = (slot) => slot.rival ? "family" : slot.district_of != null ? "district" : isRacketSlot(slot) ? "racket" : "character";

  function bind(event, state, rng) {
    const bindings = {};
    const family = playerFamily(state);
    for (const [name, slot] of Object.entries(event.cast)) {
      let candidates;
      const kind = slotKind(slot);
      if (kind === "family") {
        candidates = Object.keys(state.rivalries);
      } else if (kind === "district") {
        const owner = slot.district_of === "family" ? family.id : bindings[slot.district_of];
        candidates = Object.values(state.districts).filter((d) => d.family_id === owner).map((d) => d.id);
      } else if (kind === "racket") {
        candidates = Object.values(state.rackets).filter((r) =>
          (slot.racket_in == null ? r.family_id === family.id : r.district_id === bindings[slot.racket_in])
          && (slot.racket_of == null || r.capo_id === bindings[slot.racket_of])
          && (slot.racket_not_of == null || r.capo_id !== bindings[slot.racket_not_of])).map((r) => r.id);
      } else if (slot.boss_of != null) {
        const boss = state.characters[state.families[bindings[slot.boss_of]].don_id];
        candidates = boss.alive ? [boss.id] : [];
      } else if (slot.investigated) {
        const taken = new Set(Object.values(bindings));
        candidates = members(state, family.id).filter((m) => m.alive && m.id in state.knowledge.investigations
          && !taken.has(m.id) && (slot.role == null || slot.role.includes(m.role))).map((m) => m.id);
      } else {
        const roles = slot.role || [];
        const taken = new Set(Object.values(bindings));
        candidates = members(state, family.id).filter((m) => m.alive && roles.includes(m.role) && !taken.has(m.id)
          && (slot.runs == null || state.rackets[bindings[slot.runs]].capo_id === m.id)).map((m) => m.id);
      }
      candidates = candidates.filter((c) => checkAll(state, bindings, slot.where || [], c));
      if (!candidates.length) return null;
      bindings[name] = rng.choice(candidates);
    }
    return bindings;
  }

  const castItems = (bindings) => Object.entries(bindings).filter(([k]) => !k.startsWith(SECRET));
  const nameOf = (state, ref) => (state.characters[ref] || state.rackets[ref] || state.families[ref] || state.districts[ref]).name;
  const joinNames = (names) => names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

  function fill(text, state, bindings, lists) {
    for (const [name, slots] of Object.entries(lists || {})) {
      const names = slots.map((slot) => nameOf(state, bindings[slot])).sort();
      text = text.split("{" + name + "}").join(joinNames(names));
    }
    for (const [name, ref] of castItems(bindings)) {
      if (ref in state.characters || ref in state.rackets || ref in state.families || ref in state.districts) {
        text = text.split("{" + name + "}").join(nameOf(state, ref));
      }
    }
    const family = playerFamily(state);
    text = text.split("{don}").join(state.characters[family.don_id].name);
    text = text.split("{you}").join(player(state).name);
    return text.split("{family}").join(family.name);
  }

  function bindingsAlive(state, bindings) {
    return castItems(bindings).every(([, ref]) => ref in state.characters ? state.characters[ref].alive
      : (ref in state.rackets || ref in state.families || ref in state.districts));
  }

  function targets(state, bindings, who) {
    if (who === "crew") return crew(state);
    return [state.characters[resolveId(state, bindings, who)]];
  }

  function ledgerFor(state, month) {
    const ledger = state.knowledge.ledger;
    for (let i = ledger.length - 1; i >= 0; i--) if (ledger[i].month === month) return ledger[i];
    return null;
  }

  function applyEffect(state, effect, bindings, rng, source, label) {
    const kind = Object.keys(effect)[0];
    const v = effect[kind];
    const family = playerFamily(state);
    switch (kind) {
      case "stat":
        for (const c of targets(state, bindings, v.who)) c.stats[v.stat] = Math.trunc(clamp(c.stats[v.stat] + v.delta));
        break;
      case "memory": {
        const about = v.about === "family" ? family.id : resolveId(state, bindings, v.about);
        for (const c of targets(state, bindings, v.who)) {
          c.memory.push({ event_id: source.id, about_id: about, month: state.month, weight: v.weight, decay_rate: v.decay });
        }
        break;
      }
      case "standing": {
        const s = state.standing;
        s.dons_trust = Math.trunc(clamp(s.dons_trust + v.dons_trust));
        s.influence = Math.trunc(clamp(s.influence + v.influence));
        s.exposure = Math.trunc(clamp(s.exposure + v.exposure));
        break;
      }
      case "treasury": book(state, label, v); break;
      case "don_mood": state.don_mood = Math.trunc(clamp(state.don_mood + v)); break;
      case "cohesion": family.cohesion = Math.trunc(clamp(family.cohesion + v)); break;
      case "assign_racket":
        if (bindings[v.racket] in state.rackets) state.rackets[bindings[v.racket]].capo_id = v.to ? bindings[v.to] : null;
        break;
      case "racket_income": {
        const racket = state.rackets[bindings[v.racket]];
        if (racket) racket.income = Math.max(0, pyRound(racket.income * (100 + v.pct) / 100));
        break;
      }
      case "flag": state.flags[v] = state.month; break;
      case "clear_flag": delete state.flags[v]; break;
      case "followup": {
        const delay = rng.randint(v.after[0], v.after[1]);
        state.scheduled.push({ event_id: v.event, month: state.month + delay, bindings: { ...bindings }, when: v.when || [] });
        break;
      }
      case "add_expense":
        if (family.expenses.every((e) => e.id !== v.id)) {
          family.expenses.push({ id: v.id, label: v.label, amount: v.amount, stipend: Boolean(v.stipend), until: null });
        }
        break;
      case "change_expense":
        for (const e of family.expenses) if (e.id === v.id) e.amount = Math.max(0, e.amount + v.delta);
        break;
      case "remove_expense": family.expenses = family.expenses.filter((e) => e.id !== v); break;
      case "allegiance":
        for (const c of targets(state, bindings, v.who)) { c.hidden.allegiance = v.to; c.hidden.allegiance_to = v.agency ?? null; }
        break;
      case "add_source":
        if (!(v.id in state.sources)) {
          const character = v.character ? bindings[v.character] : null;
          const name = fill(v.name, state, bindings);
          state.sources[v.id] = { id: v.id, name, kind: v.kind, reliability: v.reliability, character_id: character, compromised: false, active: true };
          state.knowledge.sources[v.id] = { name, kind: v.kind, believed: v.believed, right: 0, wrong: 0, active: true };
        }
        break;
      case "compromise_source": if (v in state.sources) state.sources[v].compromised = true; break;
      case "remove_source":
        if (v in state.sources) { state.sources[v].active = false; state.knowledge.sources[v].active = false; }
        break;
      case "assign_roles": {
        const pool = v.pool.map((slot) => bindings[slot]);
        rng.shuffle(pool);
        v.roles.forEach((role, i) => { bindings[role] = pool[i]; });
        break;
      }
      case "add_vice":
        for (const c of targets(state, bindings, v.who)) if (!c.hidden.vices.includes(v.vice)) c.hidden.vices.push(v.vice);
        break;
      case "retire":
      case "kill":
        removeFromPlay(state, state.characters[resolveId(state, bindings, v)], kind === "retire" ? "gone" : "killed");
        break;
      case "health":
        for (const c of targets(state, bindings, v.who)) c.hidden.health = Math.trunc(clamp(c.hidden.health + v.delta));
        break;
      case "rivalry": {
        const rivalry = state.rivalries[bindings[v.who]];
        const stage = v.set_stage != null ? v.set_stage : Math.trunc(clamp(rivalry.stage + v.stage, 0, WAR));
        rivalry.stage = stage;
        if (stage !== WAR) rivalry.war_months = 0;
        rivalry.tension = Math.trunc(clamp(rivalry.tension + v.tension));
        break;
      }
      case "transfer_district": {
        const district = state.districts[bindings[v.district]];
        district.family_id = v.to === "family" ? family.id : bindings[v.to];
        for (const r of Object.values(state.rackets)) {
          if (r.district_id === district.id) { r.family_id = district.family_id; r.capo_id = null; }
        }
        break;
      }
      case "strength":
      case "heat": {
        const target = v.who === "family" ? family : state.families[bindings[v.who]];
        target[kind] = Math.trunc(clamp(target[kind] + v.delta));
        break;
      }
      case "sitdown": startSitdown(state, rng, bindings[v], CURRENT); break;
      case "investigation": {
        const inv = state.investigations[resolveId(state, bindings, v.who)];
        if (inv) inv.progress = Math.trunc(clamp(inv.progress + v.progress, 0, 99));
        break;
      }
      case "drop_investigation": {
        const target = resolveId(state, bindings, v);
        delete state.investigations[target];
        delete state.knowledge.investigations[target];
        break;
      }
      case "succession": {
        const backed = v.backed ? bindings[v.backed] : null;
        bindings.winner = installSuccessor(state, rng, v.candidates.map((c) => bindings[c]), backed, CURRENT);
        break;
      }
      case "recruit": bindings[v.bind] = recruit(state, rng, v.profile, CURRENT); break;
      case "add_racket": {
        const racketId = v.id in state.rackets ? `${v.id}_${state.month}` : v.id;
        state.rackets[racketId] = {
          id: racketId, name: fill(v.name, state, bindings), kind: v.kind, family_id: family.id,
          capo_id: v.capo ? bindings[v.capo] : null, district_id: bindings[v.district],
          income: v.income, heat_per_month: v.heat_per_month, heat: 0,
        };
        bindings[v.bind] = racketId;
        break;
      }
      case "remove_racket": delete state.rackets[bindings[v] ?? ""]; break;
      case "promote": state.characters[resolveId(state, bindings, v.who)].role = v.role; break;
      case "defect": {
        const man = state.characters[resolveId(state, bindings, v.who)];
        const rival = state.families[bindings[v.to]];
        family.member_ids = family.member_ids.filter((m) => m !== man.id);
        rival.member_ids.push(man.id);
        man.family_id = rival.id;
        man.role = "associate";
        for (const r of Object.values(state.rackets)) {
          if (r.capo_id === man.id) { r.family_id = rival.id; r.capo_id = null; }
        }
        delete state.knowledge.impressions[man.id];
        break;
      }
      case "unassign": {
        const target = resolveId(state, bindings, v);
        for (const r of Object.values(state.rackets)) if (r.capo_id === target) r.capo_id = null;
        break;
      }
      default: throw new Error(`unknown effect ${kind}`);
    }
  }

  // ---- information (engine/matters.py) ----
  function otherSources(state, kinds, about, exclude) {
    const pool = usableSources(state).filter((s) => (s.character_id === null || s.character_id !== about) && !exclude.has(s.id));
    const fitting = pool.filter((s) => kinds.includes(s.kind)).map((s) => s.id);
    return fitting.length ? fitting : pool.map((s) => s.id);
  }

  function reportOn(state, rng, intel, bindings, about, exclude) {
    const candidates = otherSources(state, intel.sources, about, exclude);
    if (!candidates.length) return null;
    const source = state.sources[rng.choice(candidates)];
    const truth = checkAll(state, bindings, intel.truth);
    let says;
    if (isCompromised(state, source)) says = !truth;
    else says = rng.chance(source.reliability) ? truth : !truth;
    return { source_id: source.id, says, month: state.month };
  }

  function apparentTrust(known, bal) {
    const w = bal.information.prior_weight;
    return (known.right + w * known.believed) / (known.right + known.wrong + w);
  }

  function canVerify(state, matter, index, content) {
    const item = matter.intel[index];
    const def = indexEvents(content).byId[matter.event_id].intel[index];
    const used = new Set(item.reports.map((r) => r.source_id));
    return state.standing.influence >= content.balance.information.verify_cost
      && otherSources(state, def.sources, item.about, used).length > 0;
  }

  /** Spend Influence to hear what a second source says about a claim. */
  function verify(state, rng, matterId, index, content) {
    const cost = content.balance.information.verify_cost;
    const matter = state.matters.find((m) => m.id === matterId);
    if (!matter || state.standing.influence < cost) return null;
    const item = matter.intel[index];
    const def = indexEvents(content).byId[matter.event_id].intel[index];
    const report = reportOn(state, rng, def, matter.bindings, item.about, new Set(item.reports.map((r) => r.source_id)));
    if (report !== null) {
      state.standing.influence -= cost;
      item.reports.push(report);
    }
    return report;
  }

  function reveal(state, rng, matter, event, bal) {
    const lines = [];
    matter.intel.forEach((item, i) => {
      const def = event.intel[i];
      if (!item.reports.length) return;
      const chance = def.reveal != null ? def.reveal : bal.information.reveal_chance;
      if (!rng.chance(chance)) return;
      const truth = checkAll(state, matter.bindings, def.truth);
      const right = [], wrong = [];
      for (const report of item.reports) {
        const known = state.knowledge.sources[report.source_id];
        if (report.says === truth) { known.right += 1; right.push(known.name); }
        else { known.wrong += 1; wrong.push(known.name); }
      }
      let line = `It came out: ${truth ? item.claim : item.denial}`;
      if (right.length) line += ` ${joinNames(right)} had it right.`;
      if (wrong.length) line += ` ${joinNames(wrong)} had it wrong.`;
      lines.push(line);
    });
    return lines;
  }

  function rollSecrets(event, bindings, rng) {
    for (const [name, p] of Object.entries(event.secrets)) {
      if (!((SECRET + name) in bindings)) bindings[SECRET + name] = rng.chance(p) ? "yes" : "no";
    }
  }

  function makeMatter(event, bindings, state, rng) {
    state.event_log[event.id] = state.month;
    let matterId = `${event.id}-${state.month}`;
    const taken = new Set(state.matters.map((m) => m.id));
    for (let n = 2; taken.has(matterId); n++) matterId = `${event.id}-${state.month}-${n}`;
    rollSecrets(event, bindings, rng);
    for (const effect of event.arise_effects) {
      applyEffect(state, effect, bindings, rng, event, fill(event.title, state, bindings, event.lists));
    }
    const intel = [];
    for (const item of event.intel) {
      const about = item.about ? bindings[item.about] : null;
      const known = { claim: fill(item.claim, state, bindings, event.lists), denial: fill(item.denial, state, bindings, event.lists), about, reports: [] };
      const report = reportOn(state, rng, item, bindings, about, new Set());
      if (report !== null) known.reports.push(report);
      intel.push(known);
    }
    return {
      id: matterId, event_id: event.id, month: state.month,
      title: fill(event.title, state, bindings, event.lists), text: fill(event.text, state, bindings, event.lists),
      options: event.options.map((o) => ({ id: o.id, label: fill(o.label, state, bindings, event.lists) })),
      bindings, waited: 0, can_wait: event.patience > 0, recommendation: null, intel,
    };
  }

  function printHeadline(state, text, bindings, lists) {
    if (text) state.knowledge.papers.push({ month: state.month, text: fill(text, state, bindings, lists), family: true });
  }

  function fireNews(state, rng, event, bindings) {
    state.event_log[event.id] = state.month;
    rollSecrets(event, bindings, rng);
    const title = fill(event.title, state, bindings, event.lists);
    for (const effect of event.effects) applyEffect(state, effect, bindings, rng, event, title);
    const text = fill(event.text, state, bindings, event.lists);
    state.knowledge.news.push({ month: state.month, title, text });
    printHeadline(state, event.headline, bindings, event.lists);
  }

  function runScheduled(state, rng, evs) {
    const due = state.scheduled.filter((s) => s.month <= state.month);
    state.scheduled = state.scheduled.filter((s) => s.month > state.month);
    for (const item of due) {
      const event = evs.byId[item.event_id];
      if (!event.even_if_gone && !bindingsAlive(state, item.bindings)) continue;
      if (!checkAll(state, item.bindings, item.when.concat(event.trigger))) continue;
      if (event.kind === "news") {
        fireNews(state, rng, event, item.bindings);
      } else if (state.matters.every((m) => m.event_id !== event.id)) {
        state.matters.push(makeMatter(event, item.bindings, state, rng));
      }
    }
  }

  function eligible(state, rng, evs) {
    const pending = new Set(state.matters.map((m) => m.event_id));
    const found = [];
    for (const event of evs.list) {
      if (event.followup_only || event.weight <= 0 || pending.has(event.id)) continue;
      const last = state.event_log[event.id];
      if (last !== undefined && (event.once || state.month - last < event.cooldown)) continue;
      const bindings = bind(event, state, rng);
      if (bindings === null || !checkAll(state, bindings, event.trigger)) continue;
      found.push([event, bindings]);
    }
    return found;
  }

  function beginMonth(state, rng, content) {
    const evs = indexEvents(content);
    runScheduled(state, rng, evs);
    const m = content.balance.matters;
    const count = rng.randint(m.per_month_min, m.per_month_max);
    let pool = eligible(state, rng, evs);
    for (const [event, bindings] of pool.filter(([e]) => e.urgent)) state.matters.push(makeMatter(event, bindings, state, rng));
    pool = pool.filter(([e]) => !e.urgent);
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const [[event, bindings]] = pool.splice(rng.weightedIndex(pool.map(([e]) => e.weight)), 1);
      if (event.kind === "news") fireNews(state, rng, event, bindings);
      else state.matters.push(makeMatter(event, bindings, state, rng));
    }
  }

  function followChance(state, don, bal) {
    const adv = bal.advice;
    let p = adv.follow_base + adv.follow_trust_weight * state.standing.dons_trust / 100 + adv.follow_mood_weight * (state.don_mood - 50) / 50;
    p += sum(don.traits.map((t) => adv.follow_traits[t] ?? 0.0));
    p += CURRENT.difficulty[state.difficulty].follow_bonus;
    return clamp(p, adv.follow_min, adv.follow_max);
  }

  function donPreference(event, don, rng, bal) {
    let best = event.options[0].id, bestScore = null;
    for (const option of event.options) {
      let score = (option.don.base ?? 0.0) + sum(don.traits.map((t) => option.don[t] ?? 0.0));
      score += rng.uniform(-bal.advice.don_noise, bal.advice.don_noise);
      if (bestScore === null || score > bestScore) { best = option.id; bestScore = score; }
    }
    return best;
  }

  function pickOutcome(option, state, bindings, rng) {
    const weights = option.outcomes.map((o) => {
      let w = o.weight;
      for (const mod of o.weight_if) if (checkAll(state, bindings, mod.when)) w *= mod.mult;
      return w;
    });
    return option.outcomes[rng.weightedIndex(weights)];
  }

  function labelOf(matter, choice) {
    if (choice === null) return null;
    if (choice === WAIT) return "Let it wait";
    return matter.options.find((o) => o.id === choice).label;
  }

  function resolveMatter(state, matter, rng, bal, evs) {
    const event = evs.byId[matter.event_id];
    const don = state.characters[playerFamily(state).don_id];
    let rec = matter.recommendation;
    if (rec === WAIT && !(matter.can_wait && matter.waited < event.patience)) rec = null;
    let choice, followed;
    if (event.you_decide) {
      if (rec === WAIT) rec = null;
      choice = rec !== null ? rec : event.default_option;
      followed = null;
    } else if (rec === null) {
      choice = donPreference(event, don, rng, bal);
      followed = null;
    } else {
      const own = donPreference(event, don, rng, bal);
      if (rng.chance(followChance(state, don, bal))) { choice = rec; followed = true; }
      else { choice = own; followed = own === rec; }
    }

    if (choice === WAIT) {
      matter.waited += 1;
      matter.recommendation = null;
      matter.can_wait = matter.waited < event.patience;
      state.knowledge.decisions.push({
        month: state.month, matter_id: matter.id, title: matter.title, recommended: labelOf(matter, rec),
        chosen: labelOf(matter, WAIT), followed, tone: "waiting",
        text: "The Don lets it sit another month.", trust_delta: 0, revealed: [],
      });
      return true;
    }

    const option = event.options.find((o) => o.id === choice);
    const outcome = pickOutcome(option, state, matter.bindings, rng);
    for (const effect of outcome.effects) applyEffect(state, effect, matter.bindings, rng, event, matter.title);
    if (followed && option.advised_exposure) {
      state.standing.exposure = Math.trunc(clamp(state.standing.exposure + option.advised_exposure));
    }
    let trust = 0;
    if (rec !== null && !event.you_decide) {
      trust = bal.advice.trust[`${followed ? "followed" : "ignored"}_${outcome.tone}`];
      state.standing.dons_trust = Math.trunc(clamp(state.standing.dons_trust + trust));
    }
    if (!event.you_decide) state.don_mood = Math.trunc(clamp(state.don_mood + bal.mood[outcome.tone]));
    state.knowledge.decisions.push({
      month: state.month, matter_id: matter.id, title: matter.title, recommended: labelOf(matter, rec),
      chosen: labelOf(matter, choice), followed, tone: outcome.tone,
      text: fill(outcome.text, state, matter.bindings, event.lists), trust_delta: trust,
      revealed: reveal(state, rng, matter, event, bal),
    });
    printHeadline(state, outcome.headline, matter.bindings, event.lists);
    return false;
  }

  function decide(state, rng, content) {
    const bal = content.balance;
    const evs = indexEvents(content);
    const his = state.matters.filter((m) => !evs.byId[m.event_id].you_decide);
    const silent = his.length > 0 && his.every((m) => m.recommendation === null);
    state.matters = state.matters.slice().filter((m) => resolveMatter(state, m, rng, bal, evs));
    if (silent && state.standing.dons_trust > bal.advice.silence_floor) state.standing.dons_trust = Math.trunc(clamp(state.standing.dons_trust - bal.advice.silence_penalty));
    const shift = (50 - state.don_mood) * bal.mood.drift_rate;
    state.don_mood = Math.trunc(clamp(state.don_mood + rng.roundStochastic(shift)));
    state.standing.influence = Math.trunc(clamp(state.standing.influence + bal.information.monthly_influence));
  }

  const eventIndex = new WeakMap();
  function indexEvents(content) {
    let evs = eventIndex.get(content);
    if (!evs) {
      evs = { list: content.events, byId: Object.fromEntries(content.events.map((e) => [e.id, e])) };
      eventIndex.set(content, evs);
    }
    return evs;
  }

  /** Put your advice on record: an option id, "wait", or null to keep quiet. */
  function recommend(state, matterId, choice) {
    const matter = state.matters.find((m) => m.id === matterId);
    if (!matter) throw new Error(`No matter ${matterId} on your desk.`);
    const allowed = matter.options.map((o) => o.id).concat(matter.can_wait ? [WAIT] : []);
    if (choice !== null && !allowed.includes(choice)) throw new Error(`${choice} is not an option.`);
    matter.recommendation = choice;
  }

  // ---- the world (engine/world.py) ----
  const WAR = 5;
  const INV_STAGES = ["surveillance", "informant_recruitment", "grand_jury", "indictment"];
  const PUBLIC_STAGE = 2;
  let CURRENT = null; // the content bundle of the call in progress, for effects that need balance or lines

  function book(state, label, amount) {
    const family = playerFamily(state);
    family.treasury += amount;
    const entry = ledgerFor(state, state.month);
    const line = { label, amount, note: "", racket_id: null };
    if (!entry) state.unbooked.push(line);
    else { entry.other.push(line); entry.treasury_end = family.treasury; }
  }

  function usableSources(state) {
    return Object.values(state.sources).filter((s) => s.active && (s.character_id === null || state.characters[s.character_id].alive));
  }

  function isCompromised(state, source) {
    if (source.compromised) return true;
    if (source.character_id === null) return false;
    return state.characters[source.character_id].hidden.allegiance !== "family";
  }

  function scheduleNews(state, eventId, bindings) {
    state.scheduled.push({ event_id: eventId, month: state.month, bindings, when: [] });
  }

  function removeFromPlay(state, man, fate) {
    man.alive = false;
    man.fate = fate;
    for (const r of Object.values(state.rackets)) if (r.capo_id === man.id) r.capo_id = null;
    for (const src of Object.values(state.sources)) {
      if (src.character_id === man.id) { src.active = false; state.knowledge.sources[src.id].active = false; }
    }
    delete state.investigations[man.id];
    delete state.knowledge.investigations[man.id];
    if (man.id === playerFamily(state).don_id) state.flags.don_gone = state.month;
    if (man.id === state.player_id) state.flags.you_gone = state.month;
  }

  function jail(state, man, bal) {
    const family = playerFamily(state);
    removeFromPlay(state, man, "jailed");
    if (man.family_id === family.id && man.id !== state.player_id) {
      const expenseId = `family_of_${man.id}`;
      if (family.expenses.every((e) => e.id !== expenseId)) {
        family.expenses.push({ id: expenseId, label: `The family of ${man.name}`, amount: bal.law.family_support, stipend: true, until: null });
      }
    }
    if (man.id === state.player_id) state.flags.you_jailed = state.month;
    scheduleNews(state, "indicted", { man: man.id });
  }

  function pressure(state, characterId) {
    const family = playerFamily(state);
    if (characterId === state.player_id) return state.standing.exposure;
    if (characterId === family.don_id) return family.heat;
    return sum(Object.values(state.rackets).filter((r) => r.capo_id === characterId).map((r) => r.heat));
  }

  function districtHeat(state, districtId) {
    const rackets = Object.values(state.rackets).filter((r) => r.district_id === districtId).map((r) => r.heat);
    return rackets.length ? pyRound(sum(rackets) / rackets.length) : 0;
  }

  function runHeat(state, rng, bal) {
    const hb = bal.heat;
    for (const racket of Object.values(state.rackets)) {
      const cooled = rng.roundStochastic(racket.heat * hb.racket_decay);
      racket.heat = Math.trunc(clamp(racket.heat + racket.heat_per_month - cooled));
    }
    for (const family of Object.values(state.families)) {
      const rackets = Object.values(state.rackets).filter((r) => r.family_id === family.id).map((r) => r.heat);
      const average = rackets.length ? sum(rackets) / rackets.length : 0;
      family.heat = Math.trunc(clamp(family.heat + rng.roundStochastic((average - family.heat) * hb.family_follow)));
    }
  }

  function investigationStage(state, characterId) {
    const inv = state.investigations[characterId];
    return inv ? INV_STAGES.indexOf(inv.stage) + 1 : 0;
  }

  function honestPoliceSource(state) {
    return usableSources(state).some((s) => s.kind === "police" && !isCompromised(state, s));
  }

  function runLaw(state, rng, bal) {
    const lb = bal.law;
    const family = playerFamily(state);
    for (const man of members(state, family.id)) {
      if (!man.alive || man.id in state.investigations) continue;
      const chance = clamp((pressure(state, man.id) - lb.open_threshold) / lb.open_scale, 0, lb.open_max);
      if (chance > 0 && rng.chance(chance)) {
        state.investigations[man.id] = {
          id: `inv-${man.id}-${state.month}`, target_id: man.id, agency: "fbi", stage: "surveillance", progress: 0, opened_month: state.month,
        };
      }
    }
    for (const targetId of Object.keys(state.investigations)) {
      const inv = state.investigations[targetId];
      const speed = CURRENT.difficulty[state.difficulty].law_speed;
      let step = (lb.base_progress + pressure(state, targetId) / lb.pressure_divisor) * speed - lb.decay;
      if ("rat_active" in state.flags) step += lb.rat_bonus;
      if ("rat_turned" in state.flags) step -= lb.turned_relief;
      const progress = inv.progress + rng.roundStochastic(step);
      if (progress >= 100) {
        if (inv.stage === "indictment") { jail(state, state.characters[targetId], bal); continue; }
        inv.stage = INV_STAGES[INV_STAGES.indexOf(inv.stage) + 1];
        inv.progress = 0;
      } else if (progress < 0) {
        if (inv.stage === "surveillance") {
          delete state.investigations[targetId];
          delete state.knowledge.investigations[targetId];
          continue;
        }
        inv.progress = 0;
      } else {
        inv.progress = progress;
      }
    }
    const learn = lb.learn_base + (honestPoliceSource(state) ? lb.learn_police : 0);
    for (const [targetId, inv] of Object.entries(state.investigations)) {
      const known = state.knowledge.investigations[targetId];
      if (known) { known.stage = inv.stage; continue; }
      if (INV_STAGES.indexOf(inv.stage) >= PUBLIC_STAGE || rng.chance(learn)) {
        state.knowledge.investigations[targetId] = { target_id: targetId, stage: inv.stage, since: state.month };
        scheduleNews(state, "investigation_learned", { man: targetId });
      }
    }
  }

  function atWar(state, familyId = null) {
    return Object.values(state.rivalries).some((r) => r.stage === WAR && (familyId === null || r.family_id === familyId));
  }

  function runRivals(state, rng, bal) {
    const rb = bal.rivals;
    const ours = playerFamily(state);
    for (const rivalry of Object.values(state.rivalries)) {
      const them = state.families[rivalry.family_id];
      if (rivalry.stage === WAR) {
        rivalry.war_months += 1;
        const ourLoss = rng.randint(rb.war_loss_min, rb.war_loss_max) + (them.strength > ours.strength + 10 ? 1 : 0);
        const theirLoss = rng.randint(rb.war_loss_min, rb.war_loss_max) + (ours.strength > them.strength + 10 ? 1 : 0);
        ours.strength = Math.trunc(clamp(ours.strength - ourLoss));
        them.strength = Math.trunc(clamp(them.strength - theirLoss));
        book(state, `The war with ${them.name}`, -rb.war_cost);
        them.treasury -= rb.war_cost;
        if (ours.strength <= rb.war_end_strength || them.strength <= rb.war_end_strength) {
          const won = ours.strength > them.strength;
          const loser = won ? them.id : ours.id;
          const districts = Object.values(state.districts).filter((d) => d.family_id === loser).map((d) => d.id);
          rivalry.stage = 0;
          rivalry.tension = 30;
          rivalry.war_months = 0;
          if (districts.length) scheduleNews(state, won ? "war_won" : "war_lost", { rival: them.id, district: rng.choice(districts) });
        }
      } else {
        const boss = state.characters[them.don_id];
        const aggression = boss.alive ? sum(boss.traits.map((t) => rb.aggression[t] ?? 0.0)) : 0.0;
        let drift = aggression * rb.aggression_weight + (them.strength - ours.strength) / rb.strength_divisor;
        drift += rng.uniform(-rb.noise, rb.noise);
        drift -= rivalry.tension * rb.calm_rate;
        rivalry.tension = Math.trunc(clamp(rivalry.tension + rng.roundStochastic(drift)));
      }
    }
    for (const family of Object.values(state.families)) {
      const fighting = family.id === ours.id ? atWar(state) : atWar(state, family.id);
      if (fighting) continue;
      family.strength = Math.trunc(clamp(family.strength + rng.roundStochastic((rb.base_strength - family.strength) * rb.regen_rate)));
    }
    if (atWar(state)) {
      for (const family of Object.values(state.families)) family.heat = Math.trunc(clamp(family.heat + bal.heat.war_heat));
    }
  }

  function syncSitdown(state) {
    const sd = state.sitdown;
    if (!sd) { state.knowledge.sitdown = null; return; }
    state.knowledge.sitdown = {
      rival_id: sd.rival_id, rival_name: state.families[sd.rival_id].name, round: sd.round,
      max_rounds: sd.max_rounds, ask: sd.ask, offer: sd.offer, patience: sd.patience, log: sd.log.slice(),
    };
  }

  function say(content, key, values) {
    let text = content.sitdown_lines[key];
    for (const [name, value] of Object.entries(values)) {
      text = text.split("{" + name + "}").join(typeof value === "number" ? "$" + value.toLocaleString("en-US") : String(value));
    }
    return text;
  }

  function startSitdown(state, rng, rivalId, content) {
    const sb = content.balance.sitdown;
    const them = state.families[rivalId], ours = playerFamily(state);
    let redLine = rng.randint(sb.red_line_min, sb.red_line_max);
    if (them.strength > ours.strength) redLine += sb.stronger_premium;
    if (them.treasury < sb.broke_treasury) redLine -= sb.broke_discount;
    redLine = Math.max(0, redLine);
    const ask = redLine + rng.randint(sb.opening_margin_min, sb.opening_margin_max);
    const boss = state.characters[them.don_id];
    const patience = sb.patience + (boss.traits.includes("cautious") ? 1 : 0) - (boss.traits.includes("hothead") ? 1 : 0);
    state.sitdown = {
      rival_id: rivalId, month: state.month, round: 1, max_rounds: sb.max_rounds, ask, offer: 0,
      patience, red_line: redLine, log: [say(content, "open", { family: them.name, ask })],
    };
    syncSitdown(state);
  }

  function endSitdown(state, deal, line, content) {
    const sd = state.sitdown;
    const them = state.families[sd.rival_id];
    const rivalry = state.rivalries[sd.rival_id];
    const family = playerFamily(state);
    let trust = 0, chosen, tone;
    if (deal) {
      const expenseId = `tribute_${them.id}`;
      family.expenses = family.expenses.filter((e) => e.id !== expenseId);
      if (sd.offer > 0) {
        family.expenses.push({ id: expenseId, label: `Tribute to ${them.name}`, amount: sd.offer, stipend: false,
          until: state.month + content.balance.sitdown.tribute_months });
      }
      rivalry.stage = 0;
      rivalry.tension = Math.trunc(clamp(rivalry.tension - 40));
      if (sd.offer - sd.red_line <= content.balance.sitdown.good_deal_margin) trust = 3;
      chosen = sd.offer ? `A deal at $${sd.offer.toLocaleString("en-US")} a month` : "A deal for nothing";
      tone = trust ? "good" : "neutral";
    } else {
      rivalry.stage = Math.min(WAR, Math.max(rivalry.stage, 2) + 1);
      rivalry.tension = Math.trunc(clamp(rivalry.tension + 15));
      trust = -2;
      chosen = "No deal";
      tone = "bad";
    }
    state.standing.dons_trust = Math.trunc(clamp(state.standing.dons_trust + trust));
    state.knowledge.decisions.push({
      month: state.month, matter_id: `sitdown-${them.id}-${sd.month}`, title: `Sit-down with ${them.name}`,
      recommended: null, chosen, followed: null, tone, text: line, trust_delta: trust, revealed: [],
    });
    state.sitdown = null;
    syncSitdown(state);
  }

  /** One round of the sit-down: "concede", "hold", "threaten" or "walk". */
  function sitdownAct(state, action, content) {
    const sb = content.balance.sitdown;
    const sd = state.sitdown;
    const them = state.families[sd.rival_id], ours = playerFamily(state);
    const rivalry = state.rivalries[sd.rival_id];
    if (action === "walk") { endSitdown(state, false, say(content, "you_walk", { family: them.name }), content); return; }
    let key;
    if (action === "concede") {
      sd.offer += sb.concession;
      sd.ask -= sb.ask_drop;
      key = "concede";
    } else if (action === "hold") {
      sd.patience -= 1;
      if (them.treasury < sb.broke_treasury) { sd.ask -= sb.hold_drop; key = "hold_gives"; } else key = "hold";
    } else if (ours.strength >= them.strength + sb.threat_margin) {
      sd.ask -= sb.threat_drop;
      rivalry.tension = Math.trunc(clamp(rivalry.tension + 10));
      key = "threat_lands";
    } else {
      sd.patience -= 2;
      rivalry.tension = Math.trunc(clamp(rivalry.tension + 15));
      key = "threat_fails";
    }
    sd.ask = Math.max(sd.ask, sd.red_line);
    sd.log.push(say(content, key, { offer: sd.offer, ask: sd.ask, family: them.name }));
    if (sd.offer >= sd.ask) endSitdown(state, true, say(content, "deal", { offer: sd.offer, family: them.name }), content);
    else if (sd.patience <= 0 || sd.round >= sd.max_rounds) endSitdown(state, false, say(content, "they_walk", { family: them.name }), content);
    else { sd.round += 1; syncSitdown(state); }
  }

  function world(state, rng, content) {
    const bal = content.balance;
    if (state.sitdown && state.sitdown.month < state.month) {
      endSitdown(state, false, say(content, "abandoned", { family: state.families[state.sitdown.rival_id].name }), content);
    }
    runHeat(state, rng, bal);
    runLaw(state, rng, bal);
    runRivals(state, rng, bal);
    state.knowledge.papers.push({ month: state.month, text: rng.choice(content.papers), family: false });
  }

  // ---- matters you put on the desk yourself (engine/matters.py) ----
  const FLAG_COOLDOWN = 6;

  function canFlag(state, capoId) {
    const man = state.characters[capoId];
    const family = playerFamily(state);
    if (!man || !man.alive || man.family_id !== family.id || man.id === state.player_id) return false;
    if (man.id === family.don_id || !Object.values(state.rackets).some((r) => r.capo_id === man.id)) return false;
    const last = state.knowledge.flagged[capoId];
    const pending = state.matters.some((m) => m.event_id === "flagged_books" && m.bindings.capo === capoId);
    return !pending && (last === undefined || state.month - last >= FLAG_COOLDOWN);
  }

  function flagBooks(state, rng, capoId, content) {
    CURRENT = content;
    if (!canFlag(state, capoId)) throw new Error("You can't bring the Don his numbers right now.");
    state.knowledge.flagged[capoId] = state.month;
    const matter = makeMatter(indexEvents(content).byId.flagged_books, { capo: capoId }, state, rng);
    state.matters.push(matter);
    return matter;
  }

  function canPropose(state, racketId, capoId) {
    const racket = state.rackets[racketId], man = state.characters[capoId];
    const family = playerFamily(state);
    if (!racket || !man || racket.family_id !== family.id || racket.capo_id === capoId) return false;
    if (!man.alive || man.family_id !== family.id || !["capo", "underboss"].includes(man.role)) return false;
    return !state.matters.some((m) => ["reassignment", "assignment"].includes(m.event_id) && m.bindings.racket === racketId);
  }

  function propose(state, rng, racketId, capoId, content) {
    CURRENT = content;
    if (!canPropose(state, racketId, capoId)) throw new Error("That move can't be proposed.");
    const current = state.rackets[racketId].capo_id;
    const evs = indexEvents(content).byId;
    const matter = current === null
      ? makeMatter(evs.assignment, { racket: racketId, to: capoId }, state, rng)
      : makeMatter(evs.reassignment, { racket: racketId, from: current, to: capoId }, state, rng);
    matter.recommendation = "move";
    state.matters.push(matter);
    return matter;
  }

  function note(state, characterId, text) {
    const t = text.trim().slice(0, 500);
    if (t) state.knowledge.notes[characterId] = t;
    else delete state.knowledge.notes[characterId];
  }

  function pin(state, characterId, pinned) {
    state.knowledge.pinned = state.knowledge.pinned.filter((p) => p !== characterId).concat(pinned ? [characterId] : []);
  }

  // ---- time (engine/lifecycle.py) ----
  function runAging(state, rng, bal) {
    const lb = bal.life;
    for (const man of Object.values(state.characters)) {
      if (!man.alive) continue;
      const age = yearOf(state.month) - man.hidden.birth_year;
      let chance = Math.max(0, age - lb.age_threshold) * lb.age_rate;
      if (man.role === "don" || man.role === "rival_boss") chance *= lb.don_factor;
      chance += sum(man.hidden.vices.map((v) => lb.vice_rate[v] ?? 0.0));
      if (chance > 0 && rng.chance(chance)) {
        man.hidden.health = Math.trunc(clamp(man.hidden.health - rng.randint(lb.decline_min, lb.decline_max)));
      }
      if (man.hidden.health < lb.spell_below && rng.chance(lb.spell_chance)) {
        man.hidden.health = Math.trunc(clamp(man.hidden.health - rng.randint(lb.spell_min, lb.spell_max)));
      }
      if (man.hidden.health <= 0) {
        removeFromPlay(state, man, "died");
        if (man.id !== state.player_id) scheduleNews(state, "funeral", { man: man.id });
      }
    }
  }

  function runRivalHeirs(state) {
    const ours = playerFamily(state).id;
    for (const family of Object.values(state.families)) {
      if (family.id === ours || state.characters[family.don_id].alive) continue;
      const heirId = family.member_ids.find((m) => state.characters[m].alive);
      if (heirId !== undefined) {
        state.characters[heirId].role = "rival_boss";
        family.don_id = heirId;
        scheduleNews(state, "new_rival_boss", { rival: family.id, boss: heirId });
      }
    }
  }

  function recruit(state, rng, profileId, content) {
    const r = content.recruits;
    const profile = r.profiles[profileId];
    const family = playerFamily(state);
    const taken = new Set(Object.values(state.characters).map((c) => c.name));
    let name, found = false;
    for (let i = 0; i < 20; i++) {
      name = `${rng.choice(r.first_names)} ${rng.choice(r.last_names)}`;
      if (!taken.has(name)) { found = true; break; }
    }
    if (!found) name += " Jr.";
    const stats = {};
    for (const stat of STATS) stats[stat] = rng.randint(profile.stats[stat][0], profile.stats[stat][1]);
    const traits = profile.traits.concat([rng.choice(profile.extra_traits)]);
    const born = Math.floor(state.month / 12) + 1958 - rng.randint(28, 42);
    const health = rng.randint(85, 100);
    const manId = `capo_${state.month}_${family.member_ids.length}`;
    state.characters[manId] = {
      id: manId, name, role: "capo", family_id: family.id, traits, stats,
      hidden: { allegiance: "family", allegiance_to: null, debts: 0, vices: [], health, birth_year: born, stash: 0 },
      memory: [], alive: true, fate: null,
    };
    family.member_ids.push(manId);
    state.knowledge.impressions[manId] = bandFor(content.observations, stats.loyalty).id;
    return manId;
  }

  function crewSize(state) {
    const family = playerFamily(state);
    return members(state, family.id).filter((m) => m.alive && m.id !== family.don_id && (m.role === "capo" || m.role === "underboss")).length;
  }

  function installSuccessor(state, rng, candidates, backed, content) {
    const sb = content.balance.succession;
    const family = playerFamily(state);
    const weights = candidates.map((cid) => {
      const man = state.characters[cid];
      let weight = man.stats.respect + man.stats.loyalty / 2;
      if (cid === backed) weight += sb.backing_bonus + state.standing.influence * sb.influence_weight;
      return weight;
    });
    const winner = state.characters[candidates[rng.weightedIndex(weights)]];
    for (const r of Object.values(state.rackets)) if (r.capo_id === winner.id) r.capo_id = null;
    winner.role = "don";
    family.don_id = winner.id;
    delete state.flags.don_gone;
    state.flags.new_don = state.month;
    state.don_mood = 50;
    state.knowledge.dons.push(winner.name);
    if (backed === winner.id) state.standing.dons_trust = sb.trust_backed_winner;
    else if (backed === null) state.standing.dons_trust = sb.trust_neutral;
    else if (rng.chance(sb.keep_base + state.standing.influence * sb.keep_influence)) state.standing.dons_trust = sb.trust_backed_loser;
    else state.flags.pushed_out = state.month;
    return winner.id;
  }

  function memoir(state) {
    const knowledge = state.knowledge;
    const family = playerFamily(state);
    const settled = knowledge.decisions.filter((d) => d.tone !== "waiting");
    const lost = members(state, family.id).filter((m) => !m.alive && m.id !== state.player_id).map((m) => `${m.name} (${m.fate})`);
    const treasuries = knowledge.ledger.map((e) => e.treasury_end);
    return {
      months: state.month + 1,
      dons: knowledge.dons.slice(),
      matters: settled.length,
      advised: settled.filter((d) => d.recommended !== null).length,
      taken: settled.filter((d) => d.followed === true).length,
      went_well: settled.filter((d) => d.tone === "good").length,
      went_badly: settled.filter((d) => d.tone === "bad").length,
      peak_treasury: Math.max(...(treasuries.length ? treasuries : [family.treasury])),
      final_treasury: family.treasury,
      districts: Object.values(state.districts).filter((d) => d.family_id === family.id).length,
      rat_found: "rat_known" in state.flags,
      lost,
      final_trust: state.standing.dons_trust,
    };
  }

  function whichEnding(state, bal) {
    const eb = bal.endings;
    const family = playerFamily(state);
    const you = player(state);
    const intact = family.strength >= eb.intact_strength && family.treasury >= eb.intact_treasury;
    if ("you_jailed" in state.flags) return "prison";
    if (!you.alive) return you.fate === "died" ? "died" : "killed";
    if ("pushed_out" in state.flags) return "pushed_out";
    if (state.standing.dons_trust <= 0) return "disposed";
    if (state.standing.exposure >= eb.exile_exposure) return "exile";
    if (family.strength <= eb.ruin_strength || family.treasury <= eb.ruin_treasury) return "ruin";
    if ("don_gone" in state.flags && crewSize(state) === 0) return "ruin";
    if ("retire" in state.flags) return intact ? "retired_intact" : "retired_diminished";
    if (state.month >= eb.last_month) return intact ? "era_intact" : "era_diminished";
    return null;
  }

  function checkEndings(state, content) {
    if (state.ending) return;
    const endingId = whichEnding(state, content.balance);
    if (endingId === null) return;
    const spec = content.endings[endingId];
    const years = Math.floor((state.month + 1) / 12);
    let text = spec.text.split("{you}").join(player(state).name).split("{family}").join(playerFamily(state).name);
    text = text.split("{years}").join(String(years)).split("{don}").join(state.characters[playerFamily(state).don_id].name);
    state.ending = { id: endingId, month: state.month, rank: spec.rank, title: spec.title, text, memoir: memoir(state) };
  }

  // ---- turn (engine/turn.py) ----
  function tick(state, rng, content) {
    CURRENT = content;
    if (state.ending) return;
    economy(state, rng, content.balance);
    decide(state, rng, content);
    world(state, rng, content);
    runAging(state, rng, content.balance);
    runRivalHeirs(state);
    characters(state, rng, content.balance);
    observation(state, rng, content.balance, content.observations);
    checkEndings(state, content);
    if (state.ending) return;
    state.month += 1;
    beginMonth(state, rng, content);
  }

  function newGame(content, seed, scenario = "default", options = {}) {
    CURRENT = content;
    const state = JSON.parse(JSON.stringify(content.scenarios[scenario]));
    state.seed = seed;
    const difficulty = options.difficulty || "normal";
    const spec = content.difficulty[difficulty];
    state.difficulty = difficulty;
    playerFamily(state).treasury += spec.treasury;
    state.standing.dons_trust = Math.trunc(clamp(state.standing.dons_trust + spec.dons_trust));
    state.standing.influence = Math.trunc(clamp(state.standing.influence + spec.influence));
    if (options.tutorial) {
      state.flags.tutorial = 0;
      state.scheduled.push({ event_id: "first_morning", month: 0, bindings: {}, when: [] });
    }
    const rng = new GameRNG(seed);
    beginMonth(state, rng, content);
    return { state, rng };
  }

  const api = {
    GameRNG, pyRound, monthLabel, player, playerFamily, members, bandFor, tick, newGame, recommend, WAIT,
    canVerify, verify, apparentTrust, sitdownAct, STAGES: ["peace", "insult", "sit-down", "retaliation", "blood", "war"],
    INV_STAGES, districtHeat, canFlag, flagBooks, canPropose, propose, note, pin, pressure,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ConsigliereEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
