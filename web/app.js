/* Web UI for Consigliere. Reads PlayerKnowledge and public facts only; the engine owns state. */
(function () {
  "use strict";
  const E = window.ConsigliereEngine;
  const CONTENT = window.CONSIGLIERE_CONTENT;
  const SAVE_KEY = "consigliere.save";
  const SAVE_VERSION = 1;
  const BAND_RANK = { estranged: 1, restless: 2, cooling: 3, steady: 4, devoted: 5 };

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
  const byId = (id) => document.getElementById(id);

  function splitLabel(label) {
    const m = /^(.*) \((.*)\)$/.exec(label);
    return m ? { what: m[1], who: m[2] } : { what: label, who: "" };
  }
  const totalIn = (e) => e.kickups.reduce((s, l) => s + l.amount, 0);
  const totalOut = (e) => e.expenses.reduce((s, l) => s + (l.note ? 0 : l.amount), 0);

  // ---- masthead ----
  function renderMast() {
    const st = game.state;
    byId("month").textContent = E.monthLabel(st.month);
    byId("treasury").textContent = money(E.playerFamily(st).treasury);
    const s = st.standing;
    const meters = [
      { label: "Don's trust", value: s.dons_trust, warn: s.dons_trust <= 25 },
      { label: "Influence", value: s.influence, warn: false },
      { label: "Exposure", value: s.exposure, warn: s.exposure >= 60 },
    ];
    byId("meters").innerHTML = meters.map((m) => `
      <div class="meter${m.warn ? " warn" : ""}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.value}" aria-label="${m.label}">
        <div class="meter-top"><span>${m.label}</span><b>${m.value}${m.warn ? "!" : ""}</b></div>
        <div class="bar"><i style="width:${m.value}%"></i></div>
      </div>`).join("");
    for (const btn of document.querySelectorAll(".tabs button")) {
      btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
    }
    byId("end-month-sub").textContent = `close ${E.monthLabel(st.month).split(" ")[0]}`;
  }

  // ---- office: the latest report ----
  function reportSheet(entry) {
    const st = game.state;
    const notes = st.knowledge.reports.filter((r) => r.month === entry.month);
    const change = entry.treasury_end - entry.treasury_start;
    const envelopes = entry.kickups.map((l) => {
      const { what, who } = splitLabel(l.label);
      return `<div class="row"><span class="who">${esc(what)}<small>${esc(who || "unattended")}</small></span><span class="num">${money(l.amount)}</span></div>`;
    }).join("");
    const expenses = entry.expenses.map((l) => `
      <div class="row${l.note === "unpaid" ? " unpaid" : ""}"><span class="who">${esc(l.label)}</span><span class="num">${l.note === "unpaid" ? "UNPAID " : ""}${money(l.amount)}</span></div>`).join("");
    const around = notes.length
      ? `<ul class="notes">${notes.map((r) => `<li class="note">${esc(r.claim)}<span class="meta">your read · ${Math.round(r.confidence * 100)}% sure</span></li>`).join("")}</ul>`
      : `<p class="quiet">Nothing out of the ordinary. Or nothing you caught.</p>`;
    return `
      <article class="sheet fresh">
        <h2>The books for ${esc(E.monthLabel(entry.month))}</h2>
        <p class="stamp">Typed for the Don's eyes · ${esc(E.playerFamily(st).name)}</p>
        <div class="section-head">Envelopes</div>
        <div class="rows">${envelopes}<div class="row total"><span>Total in</span><span class="num">${money(totalIn(entry))}</span></div></div>
        <div class="section-head">Expenses</div>
        <div class="rows">${expenses}<div class="row total"><span>Total out</span><span class="num">${money(totalOut(entry))}</span></div></div>
        <div class="net"><span>Treasury ${money(entry.treasury_start)} → ${money(entry.treasury_end)}</span><span class="delta${change < 0 ? " down" : ""}">${signed(change)}</span></div>
        <div class="section-head">Around the family</div>
        ${around}
      </article>`;
  }

  function introMemo() {
    const st = game.state;
    const fam = E.playerFamily(st);
    const don = st.characters[fam.don_id];
    const capos = Object.values(st.characters).filter((c) => c.role === "capo").length;
    return `
      <article class="sheet memo fresh">
        <h2>${esc(E.monthLabel(st.month))}</h2>
        <p class="stamp">A word before the year begins</p>
        <p>You are ${esc(E.player(st).name)}, consigliere to ${esc(don.name)}. He keeps his own counsel. He keeps you for yours.</p>
        <p>${capos} capos bring envelopes to the house each month. What they bring is what the family lives on. What they keep back is their business, until it becomes yours.</p>
        <p>Read the books. Read the men who bring them. When you are ready, end the month.</p>
      </article>`;
  }

  function renderOffice() {
    const ledger = game.state.knowledge.ledger;
    return ledger.length ? reportSheet(ledger[ledger.length - 1]) : introMemo();
  }

  // ---- family: who runs what, and how you read them ----
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
    const people = crew.map((m) => {
      const rackets = Object.values(st.rackets).filter((r) => r.capo_id === m.id);
      const note = lastNote(m.id);
      return `
        <div class="person">
          <div class="person-head"><h3>${esc(m.name)}</h3>${readingHtml(st.knowledge.impressions[m.id])}</div>
          <div class="role">${esc(titleCase(m.role))}</div>
          ${rackets.length ? `<ul class="rackets">${rackets.map((r) => `<li>${esc(r.name)}</li>`).join("")}</ul>` : ""}
          ${note ? `<div class="lastnote">${esc(E.monthLabel(note.month))}: ${esc(note.claim)}</div>` : ""}
        </div>`;
    }).join("");
    return `
      <article class="sheet fresh">
        <h2>${esc(fam.name)}</h2>
        <p class="stamp">Don ${esc(don.name)} · your read on each man, as of today</p>
        <div class="people">${people}</div>
      </article>`;
  }

  // ---- books: history ----
  function treasuryChart(ledger) {
    const W = 340, H = 120, L = 8, R = 8, T = 14, B = 20;
    const vals = [ledger[0].treasury_start, ...ledger.map((e) => e.treasury_end)];
    const max = Math.max(...vals), min = Math.min(0, ...vals);
    const span = max - min || 1;
    const x = (i) => L + (i * (W - L - R)) / Math.max(vals.length - 1, 1);
    const y = (v) => T + (H - T - B) * (1 - (v - min) / span);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const area = `M${x(0)},${y(min)} L${pts.join(" L")} L${x(vals.length - 1)},${y(min)} Z`;
    const lastX = x(vals.length - 1), lastY = y(vals[vals.length - 1]);
    return `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Treasury from ${money(vals[0])} to ${money(vals[vals.length - 1])}">
        <line class="grid" x1="${L}" x2="${W - R}" y1="${y(min)}" y2="${y(min)}"></line>
        <line class="grid" x1="${L}" x2="${W - R}" y1="${y(max)}" y2="${y(max)}"></line>
        <path class="area" d="${area}"></path>
        <polyline class="line" points="${pts.join(" ")}"></polyline>
        <circle class="end" cx="${lastX}" cy="${lastY}" r="4"></circle>
        <text x="${L}" y="${H - 5}">${esc(E.monthLabel(ledger[0].month))}</text>
        <text x="${W - R}" y="${H - 5}" text-anchor="end">${esc(E.monthLabel(ledger[ledger.length - 1].month))}</text>
        <text x="${L}" y="${Math.max(y(max) - 4, 10)}">${money(max)}</text>
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
      const [mon, yr] = E.monthLabel(e.month).split(" ");
      return `<tr><td>${mon.slice(0, 3)} ${yr}</td><td>${money(totalIn(e))}</td><td${unpaid ? ' class="flag"' : ""}>${money(totalOut(e))}${unpaid ? "*" : ""}</td><td>${money(e.treasury_end)}</td></tr>`;
    }).join("");
    const anyUnpaid = ledger.some((e) => e.expenses.some((l) => l.note === "unpaid"));
    const notes = st.knowledge.reports.slice().reverse();
    return `
      <article class="sheet fresh">
        <h2>The books</h2>
        <p class="stamp">${ledger.length} month${ledger.length === 1 ? "" : "s"} on record</p>
        ${treasuryChart(ledger)}
        <div class="table-wrap"><table>
          <thead><tr><th>Month</th><th>In</th><th>Out</th><th>Treasury</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${anyUnpaid ? `<p class="quiet">* Some bills went unpaid that month.</p>` : ""}
        <div class="section-head">Everything you noticed</div>
        ${notes.length
          ? `<ul class="notes">${notes.map((r) => `<li class="note">${esc(r.claim)}<span class="meta">${esc(E.monthLabel(r.month))} · ${Math.round(r.confidence * 100)}% sure</span></li>`).join("")}</ul>`
          : `<p class="quiet">Nothing yet.</p>`}
      </article>
      ${meta}`;
  }

  // ---- wiring ----
  function render() {
    renderMast();
    const view = byId("view");
    view.innerHTML = tab === "family" ? renderFamily() : tab === "books" ? renderBooks() : renderOffice();
    const on = (id, fn) => { const el = byId(id); if (el) el.addEventListener("click", fn); };
    on("new-game", () => { confirmingNewGame = true; render(); });
    on("cancel-new", () => { confirmingNewGame = false; render(); });
    on("confirm-new", () => { confirmingNewGame = false; startNewGame(); save(); render(); });
  }

  function endMonth() {
    E.tick(game.state, game.rng, CONTENT);
    tab = "office";
    confirmingNewGame = false;
    save();
    render();
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
    window.claude?.hot?.snapshot?.(() => ({ state: game.state, rng: game.rng.getState(), tab }));
    render();
  }

  if (window.claude?.hot?.ready) window.claude.hot.ready(start);
  else start(window.claude?.hot?.data ?? {});
})();
