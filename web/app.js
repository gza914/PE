/* Web UI for Consigliere. Reads PlayerKnowledge and public facts; sends advice through the engine. */
(function () {
  "use strict";
  const E = window.ConsigliereEngine;
  const CONTENT = window.CONSIGLIERE_CONTENT;
  const SAVE_KEY = "consigliere.save";
  const SAVE_VERSION = 5;
  const BAND_RANK = { estranged: 1, restless: 2, cooling: 3, steady: 4, devoted: 5 };
  const TONE_LABEL = { good: "Went well", bad: "Went badly", neutral: "No harm done", waiting: "Put off" };

  let game = null; // { state, rng }
  let tab = "office";
  let confirmingNewGame = false;

  // ---- persistence (per-browser convenience; the game still runs without it) ----
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, state: game.state, rng: game.rng.getState(), tab }));
    } catch (e) { /* storage unavailable: play on without saving */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.v !== SAVE_VERSION || data.state.schema_version !== CONTENT.scenarios.default.schema_version) return null;
      return data;
    } catch (e) { return null; }
  }

  function freshSeed() {
    try { return crypto.getRandomValues(new Uint32Array(1))[0]; }
    catch (e) { return Math.floor(Date.now() % 4294967296); }
  }

  function startNewGame() {
    game = E.newGame(CONTENT, freshSeed());
    tab = "office";
  }

  // ---- formatting ----
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US");
  const signed = (n) => (n >= 0 ? "+" : "-") + "$" + Math.abs(n).toLocaleString("en-US");
  const titleCase = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const paras = (text) => text.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("");
  const byId = (id) => document.getElementById(id);
  const shortMonth = (m) => { const [mon, yr] = E.monthLabel(m).split(" "); return `${mon.slice(0, 3)} ${yr}`; };

  function splitLabel(label) {
    const m = /^(.*) \((.*)\)$/.exec(label);
    return m ? { what: m[1], who: m[2] } : { what: label, who: "" };
  }
  const totalIn = (e) => e.kickups.reduce((s, l) => s + l.amount, 0);
  const totalOut = (e) => e.expenses.reduce((s, l) => s + (l.note ? 0 : l.amount), 0);

  function moodWord(mood) {
    if (mood < 25) return "Foul";
    if (mood < 42) return "Short";
    if (mood < 60) return "Even";
    if (mood < 78) return "Warm";
    return "Expansive";
  }

  // ---- masthead ----
  function renderMast() {
    const st = game.state;
    const fam = E.playerFamily(st);
    byId("family-name").textContent = fam.name;
    byId("month").textContent = E.monthLabel(st.month);
    const s = st.standing;
    const meters = [
      { label: "Treasury", text: money(fam.treasury), warn: fam.treasury < 10000 },
      { label: "Don's trust", value: s.dons_trust, warn: s.dons_trust <= 25 },
      { label: "Influence", value: s.influence },
      { label: "Exposure", value: s.exposure, warn: s.exposure >= 60 },
      { label: "Heat", value: fam.heat, warn: fam.heat >= 60 },
      { label: "Don's mood", word: moodWord(st.don_mood), warn: st.don_mood < 25 },
    ];
    byId("meters").innerHTML = meters.map((m) => {
      const cls = `meter${m.warn ? " warn" : ""}${m.word ? " word" : ""}`;
      const shown = m.value !== undefined ? m.value : m.text || m.word;
      const bar = m.value !== undefined ? `<div class="bar"><i style="width:${m.value}%"></i></div>` : `<div class="bar" style="visibility:hidden"></div>`;
      const aria = m.value !== undefined ? ` role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.value}" aria-label="${m.label}"` : "";
      return `<div class="${cls}"${aria}><span class="label">${m.label}${m.warn ? " !" : ""}</span><b>${esc(String(shown))}</b>${bar}</div>`;
    }).join("");
    const pending = st.matters.length;
    const advised = st.matters.filter((m) => m.recommendation !== null).length;
    byId("end-month-sub").textContent = st.ending ? "the story is over"
      : pending ? `${pending} matter${pending === 1 ? "" : "s"} · ${advised} advised`
      : `close ${E.monthLabel(st.month).split(" ")[0]}`;
    byId("end-month").disabled = Boolean(st.ending);
    for (const btn of document.querySelectorAll(".tabs button")) {
      btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
      if (btn.dataset.tab === "office") btn.innerHTML = `Office${pending ? `<span class="count">${pending}</span>` : ""}`;
    }
  }

  // ---- office: the desk ----
  const eventDef = (id) => CONTENT.events.find((e) => e.id === id);

  function decisionCard(m, def) {
    const chosen = m.recommendation ?? def.default_option;
    const buttons = m.options.map((o) => `<button class="choice" aria-pressed="${chosen === o.id}" data-matter="${esc(m.id)}" data-choice="${esc(o.id)}">
      <span class="box" aria-hidden="true"></span><span>${esc(o.label)}</span></button>`).join("");
    return `
      <article class="matter yours fresh">
        <div class="kicker">Yours to decide</div>
        <h3>${esc(m.title)}</h3>
        <div class="body">${paras(m.text)}</div>
        ${intelHtml(m)}
        <div class="choices" role="group" aria-label="Your decision on ${esc(m.title)}">${buttons}</div>
        <div class="advice-status"><b>${esc(m.options.find((o) => o.id === chosen).label)}.</b> Nobody else is asked. It happens when you end the month.</div>
      </article>`;
  }

  function matterCard(m) {
    const def = eventDef(m.event_id);
    if (def.you_decide) return decisionCard(m, def);
    const choice = (id, label, aside) => {
      const pressed = m.recommendation === id;
      return `<button class="choice${aside ? " aside" : ""}" aria-pressed="${pressed}" data-matter="${esc(m.id)}" data-choice="${id === null ? "" : esc(id)}">
        <span class="box" aria-hidden="true"></span><span>${esc(label)}</span></button>`;
    };
    const current = m.recommendation === null ? "Saying nothing"
      : m.recommendation === E.WAIT ? "Advising him to let it wait"
      : `Advising: ${m.options.find((o) => o.id === m.recommendation).label}`;
    return `
      <article class="matter fresh">
        <h3>${esc(m.title)}</h3>
        ${m.waited ? `<div class="waited">Put off ${m.waited} month${m.waited === 1 ? "" : "s"}. The Don will not wait again.</div>` : ""}
        <div class="body">${paras(m.text)}</div>
        ${intelHtml(m)}
        <div class="choices" role="group" aria-label="Your advice on ${esc(m.title)}">
          ${m.options.map((o) => choice(o.id, o.label, false)).join("")}
          <div class="choice-row">
            ${m.can_wait ? choice(E.WAIT, "Advise him to let it wait", true) : ""}
            ${choice(null, "Say nothing. No risk, no credit.", true)}
          </div>
        </div>
        <div class="advice-status"><b>${esc(current)}.</b> The Don decides when you end the month.</div>
      </article>`;
  }

  const pct = (x) => Math.round(x * 100);
  const trustOf = (sourceId) => E.apparentTrust(game.state.knowledge.sources[sourceId], CONTENT.balance);

  function trustChip(sourceId) {
    const t = pct(trustOf(sourceId));
    return `<span class="trust" title="How far you trust this source, from your first impression and what he has got right">
      <span class="trust-bar" aria-hidden="true"><i style="width:${t}%"></i></span>${t}% trusted</span>`;
  }

  function intelHtml(m) {
    if (!m.intel.length) return "";
    const cost = CONTENT.balance.information.verify_cost;
    const items = m.intel.map((item, i) => {
      const reports = item.reports.map((r) => {
        const known = game.state.knowledge.sources[r.source_id];
        return `<li class="slip"><div class="slip-head"><span class="src">${esc(known.name)}</span>${trustChip(r.source_id)}</div>
          <div class="says">${esc(r.says ? item.claim : item.denial)}</div></li>`;
      }).join("");
      const split = item.reports.length > 1 && new Set(item.reports.map((r) => r.says)).size > 1;
      const can = E.canVerify(game.state, m, i, CONTENT);
      const why = game.state.standing.influence < cost ? `You need ${cost} Influence.` : "Nobody else would know.";
      return `<div class="intel-item">
        <ul class="slips">${reports || `<li class="slip quiet">Nobody has said anything yet.</li>`}</ul>
        <div class="intel-foot">
          ${split ? `<span class="split">Your sources disagree.</span>` : `<span></span>`}
          <button class="verify" data-matter="${esc(m.id)}" data-intel="${i}" ${can ? "" : `disabled title="${esc(why)}"`}>Ask another source · ${cost} Influence</button>
        </div></div>`;
    }).join("");
    return `<div class="intel"><div class="intel-head">What you've heard</div>${items}</div>`;
  }

  function newsCard(n) {
    return `<article class="news fresh"><div class="kicker">Word came this month</div><h3>${esc(n.title)}</h3>${paras(n.text)}</article>`;
  }

  function patienceWord(p) {
    if (p >= 3) return "Steady";
    if (p === 2) return "Wearing thin";
    return "Nearly gone";
  }

  function sitdownCard(sd) {
    const cost = CONTENT.balance.sitdown.concession;
    return `
      <article class="sitdown fresh">
        <div class="kicker">At the table · round ${sd.round} of ${sd.max_rounds}</div>
        <h3>Sit-down with ${esc(sd.rival_name)}</h3>
        <div class="terms">
          <div><span class="label">They ask</span><b>${money(sd.ask)}</b><small>a month</small></div>
          <div><span class="label">You offer</span><b>${money(sd.offer)}</b><small>a month</small></div>
          <div><span class="label">Their patience</span><b class="${sd.patience <= 1 ? "warn" : ""}">${patienceWord(sd.patience)}</b></div>
        </div>
        <ol class="table-log">${sd.log.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
        <div class="table-moves">
          <button class="move" data-move="concede">Offer ${money(cost)} more</button>
          <button class="move" data-move="hold">Hold firm</button>
          <button class="move" data-move="threaten">Threaten</button>
          <button class="move quiet-move" data-move="walk">Walk away</button>
        </div>
        <p class="advice-status">You speak for the family at this table; the Don is not here. If you leave it unfinished at the end of the month, they will take that as an answer.</p>
      </article>`;
  }

  function renderDesk() {
    const st = game.state;
    const news = st.knowledge.news.filter((n) => n.month === st.month);
    const items = (st.knowledge.sitdown ? [sitdownCard(st.knowledge.sitdown)] : [])
      .concat(news.map(newsCard), st.matters.map(matterCard));
    return `
      <section class="col" aria-label="Your desk">
        <div class="col-head"><h2>On your desk</h2><small>${esc(E.monthLabel(st.month))}</small></div>
        ${items.length ? items.join("") : `<p class="empty">Nothing needs the Don this month. End the month when you're ready.</p>`}
      </section>`;
  }

  // ---- office: last month's report ----
  function decisionsHtml(decisions) {
    if (!decisions.length) return "";
    return `<div class="section-head">The Don's decisions</div><div class="decisions">${decisions.map((d) => {
      const advice = d.recommended === null ? "You said nothing." : `You advised <b>${esc(d.recommended)}</b>.`;
      const did = d.followed === null ? `He chose <b>${esc(d.chosen)}</b>.`
        : d.followed ? `He did as you advised.` : `He chose <b>${esc(d.chosen)}</b> instead.`;
      const trust = d.trust_delta ? ` Don's trust ${d.trust_delta > 0 ? "+" : ""}${d.trust_delta}.` : "";
      return `<div class="decision">
        <div class="decision-head"><h4>${esc(d.title)}</h4><span class="tone ${d.tone}">${TONE_LABEL[d.tone]}</span></div>
        <div class="what">${advice} ${did}${trust}</div>
        <p>${esc(d.text)}</p>
        ${(d.revealed || []).map((line) => `<div class="revealed">${esc(line)}</div>`).join("")}</div>`;
    }).join("")}</div>`;
  }

  function reportSheet(entry) {
    const st = game.state;
    const notes = st.knowledge.reports.filter((r) => r.month === entry.month);
    const decisions = st.knowledge.decisions.filter((d) => d.month === entry.month);
    const change = entry.treasury_end - entry.treasury_start;
    const envelopes = entry.kickups.map((l) => {
      const { what, who } = splitLabel(l.label);
      return `<div class="row"><span class="who">${esc(what)}<small>${esc(who || "unattended")}</small></span><span class="num">${money(l.amount)}</span></div>`;
    }).join("");
    const expenses = entry.expenses.map((l) => `
      <div class="row${l.note === "unpaid" ? " unpaid" : ""}"><span class="who">${esc(l.label)}</span><span class="num">${l.note === "unpaid" ? "UNPAID " : ""}${money(l.amount)}</span></div>`).join("");
    const other = (entry.other || []).map((l) => `
      <div class="row"><span class="who">${esc(l.label)}</span><span class="num${l.amount < 0 ? " neg" : ""}">${signed(l.amount)}</span></div>`).join("");
    return `
      <article class="sheet fresh">
        <h2>${esc(E.monthLabel(entry.month))}</h2>
        <p class="stamp">Typed for the Don's eyes</p>
        ${decisionsHtml(decisions)}
        <div class="section-head">Envelopes</div>
        <div class="rows">${envelopes}<div class="row total"><span>Total in</span><span class="num">${money(totalIn(entry))}</span></div></div>
        <div class="section-head">Expenses</div>
        <div class="rows">${expenses}<div class="row total"><span>Total out</span><span class="num">${money(totalOut(entry))}</span></div></div>
        ${other ? `<div class="section-head">Decisions that cost or paid</div><div class="rows">${other}</div>` : ""}
        <div class="net"><span>Treasury ${money(entry.treasury_start)} → ${money(entry.treasury_end)}</span><span class="delta${change < 0 ? " down" : ""}">${signed(change)}</span></div>
        <div class="section-head">Around the family</div>
        ${notes.length
          ? `<ul class="notes">${notes.map((r) => `<li class="note">${esc(r.claim)}<span class="meta">your read · ${Math.round(r.confidence * 100)}% sure</span></li>`).join("")}</ul>`
          : `<p class="quiet">Nothing out of the ordinary. Or nothing you caught.</p>`}
      </article>`;
  }

  function introMemo() {
    const st = game.state;
    const fam = E.playerFamily(st);
    const don = st.characters[fam.don_id];
    return `
      <article class="sheet memo fresh">
        <h2>Before the year begins</h2>
        <p class="stamp">${esc(E.monthLabel(st.month))}</p>
        <p>You are ${esc(E.player(st).name)}, consigliere to ${esc(don.name)}. He keeps his own counsel. He keeps you for yours.</p>
        <p>Each month, matters reach your desk. Advise him, tell him to wait, or say nothing. He listens more when he trusts you, and less when his mood is bad. When he follows you and it goes wrong, it is your name on it.</p>
        <p>Most of what reaches you is secondhand. Each claim comes from a source, and you can spend Influence to ask someone else. Some sources are better than their reputation. Some are worse.</p>
        <p>Four capos bring envelopes to the house. Read the books, and read the men who bring them.</p>
      </article>`;
  }

  function renderOffice() {
    const ledger = game.state.knowledge.ledger;
    const report = ledger.length ? reportSheet(ledger[ledger.length - 1]) : introMemo();
    return `<div class="office">${renderDesk()}
      <section class="col" aria-label="Last month">
        <div class="col-head"><h2>${ledger.length ? "Last month" : "A word first"}</h2><small><kbd>N</kbd> ends the month</small></div>
        ${report}
      </section></div>`;
  }

  // ---- family ----
  function readingHtml(bandId) {
    const band = CONTENT.observations.loyalty_bands.find((b) => b.id === bandId);
    const rank = BAND_RANK[bandId] || 0;
    const pips = [1, 2, 3, 4, 5].map((i) => `<i class="${i <= rank ? "on" : ""}"></i>`).join("");
    return `<span class="reading${rank && rank <= 2 ? " low" : ""}"><span class="pips" aria-hidden="true">${pips}</span><span>${esc(band ? band.label : "unknown")}</span></span>`;
  }

  function renderFamily() {
    const st = game.state;
    const fam = E.playerFamily(st);
    const don = st.characters[fam.don_id];
    const crew = E.members(st, fam.id).filter((m) => m.role === "underboss" || m.role === "capo");
    const lastNote = (id) => {
      const notes = st.knowledge.reports.filter((r) => r.subject_id === id);
      return notes.length ? notes[notes.length - 1] : null;
    };
    const FATE = { jailed: "In prison", killed: "Killed", gone: "Gone", died: "Died" };
    const people = crew.map((m) => {
      const rackets = Object.values(st.rackets).filter((r) => r.capo_id === m.id);
      const note = lastNote(m.id);
      const inv = st.knowledge.investigations[m.id];
      if (!m.alive) {
        return `<article class="person gone fresh"><div class="role">${esc(titleCase(m.role))} · ${FATE[m.fate] || "Gone"}</div><h3>${esc(m.name)}</h3></article>`;
      }
      return `
        <article class="person fresh">
          <div class="role">${esc(titleCase(m.role))}</div>
          <h3>${esc(m.name)}</h3>
          ${readingHtml(st.knowledge.impressions[m.id])}
          ${inv ? `<div class="law-flag">Under investigation: ${esc(titleCase(inv.stage))}</div>` : ""}
          ${rackets.length ? `<ul class="rackets">${rackets.map((r) => `<li>${esc(r.name)}</li>`).join("")}</ul>` : `<p class="quiet">Runs no rackets of his own.</p>`}
          ${note ? `<div class="lastnote">${esc(shortMonth(note.month))}: ${esc(note.claim)}</div>` : ""}
        </article>`;
    }).join("");
    const unattended = Object.values(st.rackets).filter((r) => r.family_id === fam.id && !r.capo_id);
    return `
      <div class="family">
        <div class="don-card">
          <div><div class="role">The Don${don.alive ? "" : " · gone"}</div><h2>${esc(don.name)}</h2></div>
          <div class="reading">Mood: ${esc(moodWord(st.don_mood).toLowerCase())}</div>
        </div>
        ${st.knowledge.dons.length > 1 ? `<p class="quiet">Dons you have served: ${st.knowledge.dons.map(esc).join(", ")}.</p>` : ""}
        <div class="col-head"><h2>His people</h2><small>your read on each man, as of today</small></div>
        <div class="people">${people}</div>
        ${unattended.length ? `<p class="quiet">Nobody is running: ${unattended.map((r) => esc(r.name)).join(", ")}.</p>` : ""}
      </div>`;
  }

  // ---- the city ----
  function tensionWord(t) {
    if (t < 20) return "Cordial";
    if (t < 40) return "Cool";
    if (t < 60) return "Strained";
    if (t < 80) return "Hostile";
    return "Murderous";
  }

  function strengthWord(theirs, ours) {
    const d = theirs - ours;
    if (d > 12) return "Stronger than us";
    if (d < -12) return "Weaker than us";
    return "About our size";
  }

  function ladder(stage) {
    return `<ol class="ladder" aria-label="From peace to war: ${esc(E.STAGES[stage])}">${E.STAGES.map((name, i) =>
      `<li class="${i === stage ? "now" : i < stage ? "past" : ""}${i === 5 ? " war" : ""}">${esc(titleCase(name))}</li>`).join("")}</ol>`;
  }

  function districtsOf(st, familyId) {
    return Object.values(st.districts).filter((d) => d.family_id === familyId).map((d) => {
      const h = E.districtHeat(st, d.id);
      return `<li><span>${esc(d.name)}</span><span class="heat-chip" title="Heat">${h}<span class="trust-bar" aria-hidden="true"><i style="width:${h}%"></i></span></span></li>`;
    }).join("");
  }

  function renderCity() {
    const st = game.state;
    const fam = E.playerFamily(st);
    const ours = `<article class="house fresh ours">
        <div class="role">Your family</div><h3>${esc(fam.name)}</h3>
        <div class="house-line">Heat ${fam.heat} · ${fam.heat >= 60 ? "the papers are interested" : fam.heat >= 35 ? "the precincts are watching" : "quiet"}</div>
        <ul class="districts">${districtsOf(st, fam.id)}</ul>
      </article>`;
    const rivals = Object.values(st.rivalries).map((rv) => {
      const them = st.families[rv.family_id];
      const boss = st.characters[them.don_id];
      return `<article class="house fresh">
        <div class="role">${esc(boss.alive ? "Boss: " + boss.name : "Leaderless")}</div><h3>${esc(them.name)}</h3>
        ${ladder(rv.stage)}
        <div class="house-line">${tensionWord(rv.tension)} · ${strengthWord(them.strength, fam.strength)}${rv.stage === 5 ? ` · at war ${rv.war_months} month${rv.war_months === 1 ? "" : "s"}` : ""}</div>
        <ul class="districts">${districtsOf(st, them.id) || `<li class="quiet">No districts left</li>`}</ul>
      </article>`;
    }).join("");
    const known = Object.values(st.knowledge.investigations);
    const law = known.length ? `<ul class="law">${known.map((k) => {
      const i = E.INV_STAGES.indexOf(k.stage);
      return `<li><b>${esc(st.characters[k.target_id].name)}</b>
        <ol class="ladder small">${E.INV_STAGES.map((s, j) => `<li class="${j === i ? "now" : j < i ? "past" : ""}">${esc(titleCase(s))}</li>`).join("")}</ol>
        <small>known since ${esc(shortMonth(k.since))}</small></li>`;
    }).join("")}</ul>` : `<p class="quiet">No investigations that you know of. That is not the same as none.</p>`;
    return `<div class="family">
      <div class="col-head"><h2>The city</h2><small>who holds what, and how things stand</small></div>
      <div class="houses">${ours}${rivals}</div>
      <div class="col-head"><h2>The law</h2><small>what you know the government is doing</small></div>
      ${law}
    </div>`;
  }

  // ---- sources ----
  function renderSources() {
    const st = game.state;
    const rows = Object.entries(st.knowledge.sources).map(([id, k]) => {
      const t = pct(trustOf(id));
      const record = k.right + k.wrong ? `${k.right} right · ${k.wrong} wrong` : "No record yet";
      return `<article class="source fresh${k.active ? "" : " gone"}">
        <div class="role">${esc(titleCase(k.kind))}${k.active ? "" : " · gone quiet"}</div>
        <h3>${esc(k.name)}</h3>
        <div class="trust-big"><span class="trust-bar" aria-hidden="true"><i style="width:${t}%"></i></span><b>${t}%</b> trusted</div>
        <div class="record">${record}</div>
        <div class="first">First impression: ${pct(k.believed)}%</div>
      </article>`;
    }).join("");
    return `<div class="family">
      <div class="col-head"><h2>Who tells you things</h2><small>trust moves when the truth comes out</small></div>
      <p class="quiet lede">Every claim on your desk comes from someone. Some are better than their reputation, some worse, and some are telling you what somebody else wants you to hear. When a matter is settled, the truth sometimes comes out, and you learn who had it right.</p>
      <div class="people">${rows}</div>
    </div>`;
  }

  // ---- books ----
  function treasuryChart(ledger) {
    const W = 640, H = 180, L = 10, R = 10, T = 18, B = 22;
    const vals = [ledger[0].treasury_start, ...ledger.map((e) => e.treasury_end)];
    const max = Math.max(...vals), min = Math.min(0, ...vals);
    const span = max - min || 1;
    const x = (i) => L + (i * (W - L - R)) / Math.max(vals.length - 1, 1);
    const y = (v) => T + (H - T - B) * (1 - (v - min) / span);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const area = `M${x(0)},${y(min)} L${pts.join(" L")} L${x(vals.length - 1)},${y(min)} Z`;
    return `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Treasury from ${money(vals[0])} to ${money(vals[vals.length - 1])}">
        <line class="grid" x1="${L}" x2="${W - R}" y1="${y(min)}" y2="${y(min)}"></line>
        <line class="grid" x1="${L}" x2="${W - R}" y1="${y(max)}" y2="${y(max)}"></line>
        <path class="area" d="${area}"></path>
        <polyline class="line" points="${pts.join(" ")}"></polyline>
        <circle class="end" cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="4"></circle>
        <text x="${L}" y="${H - 5}">${esc(shortMonth(ledger[0].month))}</text>
        <text x="${W - R}" y="${H - 5}" text-anchor="end">${esc(shortMonth(ledger[ledger.length - 1].month))}</text>
        <text x="${L}" y="${Math.max(y(max) - 5, 11)}">${money(max)}</text>
      </svg>`;
  }

  function renderBooks() {
    const st = game.state;
    const ledger = st.knowledge.ledger;
    const meta = `
      <div class="game-meta">
        <span>Game seed ${st.seed}</span>
        ${confirmingNewGame
          ? `<span class="confirm"><span>Burn these books and start over?</span><button class="btn-danger" id="confirm-new">Start over</button><button class="btn-quiet" id="cancel-new">Keep playing</button></span>`
          : `<button class="btn-quiet" id="new-game">New game</button>`}
      </div>`;
    if (!ledger.length) {
      return `<article class="sheet fresh"><h2>The books</h2><p class="quiet">Nothing written yet. End a month and the first page fills in.</p></article>${meta}`;
    }
    const rows = ledger.slice().reverse().map((e) => {
      const unpaid = e.expenses.some((l) => l.note === "unpaid");
      const other = (e.other || []).reduce((s, l) => s + l.amount, 0);
      return `<tr><td>${shortMonth(e.month)}</td><td>${money(totalIn(e))}</td><td${unpaid ? ' class="flag"' : ""}>${money(totalOut(e))}${unpaid ? "*" : ""}</td><td>${other ? signed(other) : "—"}</td><td>${money(e.treasury_end)}</td></tr>`;
    }).join("");
    const decisions = st.knowledge.decisions.filter((d) => d.tone !== "waiting");
    const followed = decisions.filter((d) => d.followed === true).length;
    const advised = decisions.filter((d) => d.followed !== null).length;
    const notes = st.knowledge.reports.slice().reverse();
    return `
      <div class="books">
        <article class="sheet fresh">
          <h2>The books</h2>
          <p class="stamp">${ledger.length} month${ledger.length === 1 ? "" : "s"} on record</p>
          ${treasuryChart(ledger)}
          <div class="table-wrap"><table>
            <thead><tr><th>Month</th><th>In</th><th>Out</th><th>Decisions</th><th>Treasury</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          ${ledger.some((e) => e.expenses.some((l) => l.note === "unpaid")) ? `<p class="quiet">* Some bills went unpaid that month.</p>` : ""}
        </article>
        <section class="col">
          <article class="sheet fresh">
            <h2>Your record</h2>
            <p class="stamp">${decisions.length} matter${decisions.length === 1 ? "" : "s"} settled</p>
            <div class="rows">
              <div class="row"><span>You gave advice</span><span class="num">${advised}</span></div>
              <div class="row"><span>He took it</span><span class="num">${followed}</span></div>
              <div class="row"><span>Went well</span><span class="num">${decisions.filter((d) => d.tone === "good").length}</span></div>
              <div class="row"><span>Went badly</span><span class="num">${decisions.filter((d) => d.tone === "bad").length}</span></div>
            </div>
            <div class="section-head">Everything you noticed</div>
            ${notes.length
              ? `<ul class="notes">${notes.map((r) => `<li class="note">${esc(r.claim)}<span class="meta">${esc(shortMonth(r.month))} · ${Math.round(r.confidence * 100)}% sure</span></li>`).join("")}</ul>`
              : `<p class="quiet">Nothing yet.</p>`}
          </article>
          ${meta}
        </section>
      </div>`;
  }

  // ---- wiring ----
  function renderEnding() {
    const e = game.state.ending;
    const m = e.memoir;
    const years = Math.floor(m.months / 12), months = m.months % 12;
    const span = `${years} year${years === 1 ? "" : "s"}${months ? ` and ${months} month${months === 1 ? "" : "s"}` : ""}`;
    const row = (label, value) => `<div class="row"><span>${esc(label)}</span><span class="num">${esc(value)}</span></div>`;
    return `
      <article class="memoir fresh">
        <div class="kicker">${esc(E.monthLabel(e.month))} · the end</div>
        <h2>${esc(e.title)}</h2>
        <div class="rank">Ending ${e.rank} of ${Object.keys(CONTENT.endings).length}, best first</div>
        <div class="memoir-text">${paras(e.text)}</div>
        <div class="memoir-grid">
          <div>
            <div class="section-head">The record</div>
            <div class="rows">
              ${row("Years as consigliere", span)}
              ${row("Dons served", m.dons.join(", "))}
              ${row("Matters settled", String(m.matters))}
              ${row("You gave advice", String(m.advised))}
              ${row("He took it", String(m.taken))}
              ${row("Went well / went badly", `${m.went_well} / ${m.went_badly}`)}
              ${row("The rat", m.rat_found ? "Found" : "Never found")}
            </div>
          </div>
          <div>
            <div class="section-head">The family</div>
            <div class="rows">
              ${row("Treasury at its peak", money(m.peak_treasury))}
              ${row("Treasury at the end", money(m.final_treasury))}
              ${row("Districts held", String(m.districts))}
              ${row("Don's trust at the end", String(m.final_trust))}
            </div>
            <div class="section-head">Lost along the way</div>
            ${m.lost.length ? `<ul class="notes">${m.lost.map((l) => `<li class="note">${esc(l)}</li>`).join("")}</ul>` : `<p class="quiet">Nobody. That almost never happens.</p>`}
          </div>
        </div>
        <div class="game-meta"><span>Game seed ${game.state.seed}</span><button class="btn-quiet" id="confirm-new">Begin again, January 1958</button></div>
      </article>`;
  }

  function render() {
    renderMast();
    const view = byId("view");
    if (game.state.ending && tab === "office") {
      view.innerHTML = renderEnding();
      byId("confirm-new").addEventListener("click", () => { startNewGame(); save(); render(); });
      return;
    }
    view.innerHTML = tab === "family" ? renderFamily() : tab === "books" ? renderBooks()
      : tab === "sources" ? renderSources() : tab === "city" ? renderCity() : renderOffice();
    const on = (id, fn) => { const el = byId(id); if (el) el.addEventListener("click", fn); };
    on("new-game", () => { confirmingNewGame = true; render(); });
    on("cancel-new", () => { confirmingNewGame = false; render(); });
    on("confirm-new", () => { confirmingNewGame = false; startNewGame(); save(); render(); });
  }

  function endMonth() {
    if (game.state.ending) return;
    E.tick(game.state, game.rng, CONTENT);
    tab = "office";
    confirmingNewGame = false;
    save();
    render();
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function onViewClick(event) {
    const check = event.target.closest(".verify");
    const btn = event.target.closest(".choice");
    const move = event.target.closest(".move");
    if (move) {
      E.sitdownAct(game.state, move.dataset.move, CONTENT);
    } else if (check && !check.disabled) {
      E.verify(game.state, game.rng, check.dataset.matter, Number(check.dataset.intel), CONTENT);
    } else if (btn) {
      const choice = btn.dataset.choice === "" ? null : btn.dataset.choice;
      E.recommend(game.state, btn.dataset.matter, choice);
    } else {
      return;
    }
    save();
    const scroll = window.scrollY;
    render();
    window.scrollTo(0, scroll);
  }

  function start(hotData) {
    const saved = (hotData && hotData.state ? hotData : null) || load();
    if (saved) {
      game = { state: saved.state, rng: E.GameRNG.fromState(saved.rng) };
      tab = saved.tab || "office";
    } else {
      startNewGame();
    }
    for (const btn of document.querySelectorAll(".tabs button")) {
      btn.addEventListener("click", () => { tab = btn.dataset.tab; confirmingNewGame = false; save(); render(); });
    }
    byId("end-month").addEventListener("click", endMonth);
    byId("view").addEventListener("click", onViewClick);
    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target instanceof HTMLInputElement)) endMonth();
    });
    window.claude?.hot?.snapshot?.(() => ({ state: game.state, rng: game.rng.getState(), tab }));
    render();
  }

  if (window.claude?.hot?.ready) window.claude.hot.ready(start);
  else start(window.claude?.hot?.data ?? {});
})();
