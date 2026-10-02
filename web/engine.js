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
    const entry = { month: state.month, kickups: [], expenses: [], other: [], treasury_start: family.treasury, treasury_end: family.treasury };
    if (family.id === player(state).family_id && state.unbooked.length) {
      entry.other = state.unbooked;
      entry.treasury_start -= sum(state.unbooked.map((l) => l.amount));
      state.unbooked = [];
    }
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
    } else if (target in state.rackets) {
      const r = state.rackets[target];
      if (attr === "income" || attr === "heat") return r[attr];
      if (attr === "kind") return r.kind;
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

  const isRacketSlot = (slot) => Boolean(slot.racket) || slot.racket_of != null || slot.racket_not_of != null;

  function bind(event, state, rng) {
    const bindings = {};
    const family = playerFamily(state);
    for (const [name, slot] of Object.entries(event.cast)) {
      let candidates;
      if (isRacketSlot(slot)) {
        candidates = Object.values(state.rackets).filter((r) => r.family_id === family.id
          && (slot.racket_of == null || r.capo_id === bindings[slot.racket_of])
          && (slot.racket_not_of == null || r.capo_id !== bindings[slot.racket_not_of])).map((r) => r.id);
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
  const nameOf = (state, ref) => (state.characters[ref] || state.rackets[ref]).name;
  const joinNames = (names) => names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

  function fill(text, state, bindings, lists) {
    for (const [name, slots] of Object.entries(lists || {})) {
      const names = slots.map((slot) => nameOf(state, bindings[slot])).sort();
      text = text.split("{" + name + "}").join(joinNames(names));
    }
    for (const [name, ref] of castItems(bindings)) {
      text = text.split("{" + name + "}").join(nameOf(state, ref));
    }
    const family = playerFamily(state);
    text = text.split("{don}").join(state.characters[family.don_id].name);
    text = text.split("{you}").join(player(state).name);
    return text.split("{family}").join(family.name);
  }

  function bindingsAlive(state, bindings) {
    return castItems(bindings).every(([, ref]) => ref in state.rackets || (ref in state.characters && state.characters[ref].alive));
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

  function book(state, label, amount) {
    const family = playerFamily(state);
    family.treasury += amount;
    const entry = ledgerFor(state, state.month);
    const line = { label, amount, note: "" };
    if (!entry) state.unbooked.push(line);
    else { entry.other.push(line); entry.treasury_end = family.treasury; }
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
      case "assign_racket": state.rackets[bindings[v.racket]].capo_id = v.to ? bindings[v.to] : null; break;
      case "racket_income": {
        const racket = state.rackets[bindings[v.racket]];
        racket.income = Math.max(0, pyRound(racket.income * (100 + v.pct) / 100));
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
          family.expenses.push({ id: v.id, label: v.label, amount: v.amount, stipend: Boolean(v.stipend) });
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
          state.sources[v.id] = { id: v.id, name: v.name, kind: v.kind, reliability: v.reliability, character_id: character, compromised: false, active: true };
          state.knowledge.sources[v.id] = { name: v.name, kind: v.kind, believed: v.believed, right: 0, wrong: 0, active: true };
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
      case "retire": {
        const gone = state.characters[resolveId(state, bindings, v)];
        gone.alive = false;
        for (const r of Object.values(state.rackets)) if (r.capo_id === gone.id) r.capo_id = null;
        break;
      }
      case "health":
        for (const c of targets(state, bindings, v.who)) c.hidden.health = Math.trunc(clamp(c.hidden.health + v.delta));
        break;
      default: throw new Error(`unknown effect ${kind}`);
    }
  }

  // ---- information (engine/matters.py) ----
  function usableSources(state) {
    return Object.values(state.sources).filter((s) => s.active && (s.character_id === null || state.characters[s.character_id].alive));
  }

  function isCompromised(state, source) {
    if (source.compromised) return true;
    if (source.character_id === null) return false;
    return state.characters[source.character_id].hidden.allegiance !== "family";
  }

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
      id: `${event.id}-${state.month}`, event_id: event.id, month: state.month,
      title: fill(event.title, state, bindings, event.lists), text: fill(event.text, state, bindings, event.lists),
      options: event.options.map((o) => ({ id: o.id, label: fill(o.label, state, bindings, event.lists) })),
      bindings, waited: 0, can_wait: event.patience > 0, recommendation: null, intel,
    };
  }

  function runScheduled(state, rng, evs) {
    const due = state.scheduled.filter((s) => s.month <= state.month);
    state.scheduled = state.scheduled.filter((s) => s.month > state.month);
    for (const item of due) {
      const event = evs.byId[item.event_id];
      if (!bindingsAlive(state, item.bindings)) continue;
      if (!checkAll(state, item.bindings, item.when.concat(event.trigger))) continue;
      if (event.kind === "news") {
        state.event_log[event.id] = state.month;
        rollSecrets(event, item.bindings, rng);
        const title = fill(event.title, state, item.bindings, event.lists);
        for (const effect of event.effects) applyEffect(state, effect, item.bindings, rng, event, title);
        const text = fill(event.text, state, item.bindings, event.lists);
        state.knowledge.news.push({ month: state.month, title, text });
      } else if (state.matters.every((m) => m.event_id !== event.id)) {
        state.matters.push(makeMatter(event, item.bindings, state, rng));
      }
    }
  }

  function eligible(state, rng, evs) {
    const pending = new Set(state.matters.map((m) => m.event_id));
    const found = [];
    for (const event of evs.list) {
      if (event.kind !== "matter" || event.followup_only || event.weight <= 0 || pending.has(event.id)) continue;
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
    const pool = eligible(state, rng, evs);
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const [[event, bindings]] = pool.splice(rng.weightedIndex(pool.map(([e]) => e.weight)), 1);
      state.matters.push(makeMatter(event, bindings, state, rng));
    }
  }

  function followChance(state, don, bal) {
    const adv = bal.advice;
    let p = adv.follow_base + adv.follow_trust_weight * state.standing.dons_trust / 100 + adv.follow_mood_weight * (state.don_mood - 50) / 50;
    p += sum(don.traits.map((t) => adv.follow_traits[t] ?? 0.0));
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
    const own = donPreference(event, don, rng, bal);
    let choice, followed;
    if (rec === null) { choice = own; followed = null; }
    else if (rng.chance(followChance(state, don, bal))) { choice = rec; followed = true; }
    else { choice = own; followed = own === rec; }

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
    if (rec !== null) {
      trust = bal.advice.trust[`${followed ? "followed" : "ignored"}_${outcome.tone}`];
      state.standing.dons_trust = Math.trunc(clamp(state.standing.dons_trust + trust));
    }
    state.don_mood = Math.trunc(clamp(state.don_mood + bal.mood[outcome.tone]));
    state.knowledge.decisions.push({
      month: state.month, matter_id: matter.id, title: matter.title, recommended: labelOf(matter, rec),
      chosen: labelOf(matter, choice), followed, tone: outcome.tone,
      text: fill(outcome.text, state, matter.bindings, event.lists), trust_delta: trust,
      revealed: reveal(state, rng, matter, event, bal),
    });
    return false;
  }

  function decide(state, rng, content) {
    const bal = content.balance;
    const evs = indexEvents(content);
    state.matters = state.matters.slice().filter((m) => resolveMatter(state, m, rng, bal, evs));
    const shift = (50 - state.don_mood) * bal.mood.drift_rate;
    state.don_mood = Math.trunc(clamp(state.don_mood + rng.roundStochastic(shift)));
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

  // ---- turn (engine/turn.py) ----
  function tick(state, rng, content) {
    economy(state, rng, content.balance);
    decide(state, rng, content);
    characters(state, rng, content.balance);
    observation(state, rng, content.balance, content.observations);
    state.month += 1;
    beginMonth(state, rng, content);
  }

  function newGame(content, seed, scenario = "default") {
    const state = JSON.parse(JSON.stringify(content.scenarios[scenario]));
    state.seed = seed;
    const rng = new GameRNG(seed);
    beginMonth(state, rng, content);
    return { state, rng };
  }

  const api = {
    GameRNG, pyRound, monthLabel, player, playerFamily, members, bandFor, tick, newGame, recommend, WAIT,
    canVerify, verify, apparentTrust,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ConsigliereEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
