"""The web engine (web/engine.js) must play the same game as the Python engine."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from consigliere.engine.commands import FlagBooks, ProposeReassign, Recommend, SitDownAct, Verify, apply
from consigliere.engine.content import events
from consigliere.engine.matters import can_flag, can_propose, can_verify
from consigliere.engine.rng import GameRNG
from consigliere.engine.scenario import load_scenario, new_game
from consigliere.engine.state import WorldState
from consigliere.engine.turn import tick
from tools.build_web import content_bundle

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

RUNNER = """
const E = require(process.argv[1]);
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
let state, rng;
if (input.fresh) ({ state, rng } = E.newGame(input.content, input.seed, "default", input.options || {}));
else { state = input.state; rng = new E.GameRNG(input.seed); }
const PLANS = [["concede"], ["hold", "concede", "threaten", "concede", "concede", "concede"], ["walk"]];
for (let i = 0; i < input.months; i++) {
  if (state.ending) break;
  const plan = PLANS[state.month % 3];
  const crew = E.members(state, E.playerFamily(state).id).filter((c) => c.alive && (c.role === "capo" || c.role === "underboss"));
  if (state.month % 7 === 3) { const c = crew.find((m) => E.canFlag(state, m.id)); if (c) E.flagBooks(state, rng, c.id, input.content); }
  if (state.month % 11 === 5) {
    const ours = Object.values(state.rackets).filter((r) => r.family_id === E.playerFamily(state).id);
    outer: for (const r of ours) for (const c of crew) if (E.canPropose(state, r.id, c.id)) { E.propose(state, rng, r.id, c.id, input.content); break outer; }
  }
  for (let k = 0; state.sitdown && k < 6; k++) E.sitdownAct(state, plan[k % plan.length], input.content);
  state.matters.forEach((m, j) => {
    m.intel.forEach((_, i) => {
      if ((state.month + i + j) % 2 === 0 && E.canVerify(state, m, i, input.content)) E.verify(state, rng, m.id, i, input.content);
    });
    const choices = m.options.map((o) => o.id).concat(m.can_wait ? ["wait"] : [], [null]);
    const def = input.content.events.find((e) => e.id === m.event_id);
    if (input.style === "cycle") E.recommend(state, m.id, choices[(state.month * 7 + j * 3) % choices.length]);
    else if (def.you_decide) E.recommend(state, m.id, m.options[0].id);
    else if (input.style === "faithful") {
      const don = state.characters[E.playerFamily(state).don_id];
      const appeal = (o) => (o.don.base ?? 0) + don.traits.reduce((t, tr) => t + (o.don[tr] ?? 0), 0);
      let best = def.options[0];
      for (const o of def.options) if (appeal(o) > appeal(best)) best = o;
      E.recommend(state, m.id, best.id);
    }
  });
  E.tick(state, rng, input.content);
}
process.stdout.write(JSON.stringify({ state, probe: rng.random() }));
"""


def bot_choice(state: WorldState, matter, index: int):
    """The same deterministic advisor as the JS runner: cycles through every kind of advice."""
    choices = [o.id for o in matter.options] + (["wait"] if matter.can_wait else []) + [None]
    return choices[(state.month * 7 + index * 3) % len(choices)]


def run_js(state: dict | None, seed: int, months: int, content: dict, style: str = "cycle", **options) -> dict:
    payload = json.dumps({"state": state, "fresh": state is None, "seed": seed, "months": months,
                          "content": content, "style": style, "options": options})
    out = subprocess.run(
        [NODE, "-e", RUNNER, str(ROOT / "web" / "engine.js")],
        input=payload, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def run_py(state: dict | None, seed: int, months: int, style: str = "cycle", **options) -> dict:
    """style "cycle" gives every kind of advice in turn; "silent" never advises; "faithful" advises what
    the Don already leans toward, so the game runs long."""
    if state is None:
        world, rng = new_game(seed, **options)
    else:
        world, rng = WorldState.model_validate(state), GameRNG(seed)
    plans = [["concede"], ["hold", "concede", "threaten", "concede", "concede", "concede"], ["walk"]]
    for _ in range(months):
        if world.ending is not None:
            break
        plan = plans[world.month % 3]
        crew = [c for c in world.members(world.player_family.id) if c.alive and c.role.value in ("capo", "underboss")]
        if world.month % 7 == 3:
            c = next((m for m in crew if can_flag(world, m.id)), None)
            if c is not None:
                apply(world, rng, FlagBooks(capo_id=c.id))
        if world.month % 11 == 5:
            ours = [r for r in world.rackets.values() if r.family_id == world.player_family.id]
            pick = next(((r, c) for r in ours for c in crew if can_propose(world, r.id, c.id)), None)
            if pick is not None:
                apply(world, rng, ProposeReassign(racket_id=pick[0].id, capo_id=pick[1].id))
        for k in range(6):
            if world.sitdown is None:
                break
            apply(world, rng, SitDownAct(action=plan[k % len(plan)]))
        for j, matter in enumerate(world.matters):
            for i in range(len(matter.intel)):
                if (world.month + i + j) % 2 == 0 and can_verify(world, matter, i):
                    apply(world, rng, Verify(matter_id=matter.id, intel_index=i))
            if style == "cycle":
                apply(world, rng, Recommend(matter_id=matter.id, choice=bot_choice(world, matter, j)))
            elif events()[matter.event_id].you_decide:
                apply(world, rng, Recommend(matter_id=matter.id, choice=matter.options[0].id))
            elif style == "faithful":
                don = world.characters[world.player_family.don_id]
                def appeal(o):
                    return o.don.get("base", 0) + sum(o.don.get(t.value, 0) for t in don.traits)
                options = events()[matter.event_id].options
                best = options[0]
                for o in options:
                    if appeal(o) > appeal(best):
                        best = o
                apply(world, rng, Recommend(matter_id=matter.id, choice=best.id))
        tick(world, rng)
    return {"state": world.model_dump(mode="json"), "probe": rng.random()}


def starting_state(seed: int) -> dict:
    return load_scenario("default", seed).model_dump(mode="json")


@pytest.fixture(scope="module")
def content():
    return content_bundle()


@pytest.mark.parametrize("seed", [0, 1234, 2**32 - 1, 77, 31337])
def test_same_seed_same_game_with_an_active_advisor(seed, content):
    js, py = run_js(None, seed, 120, content), run_py(None, seed, 120)
    assert py["state"]["knowledge"]["decisions"], "the bot should have settled some matters"
    assert js == py


@pytest.mark.parametrize("seed", [3, 1234, 77, 2024, 31337, 9])
def test_same_seed_same_fifteen_years_with_a_faithful_advisor(seed, content):
    js, py = run_js(None, seed, 180, content, "faithful"), run_py(None, seed, 180, "faithful")
    assert py["state"]["ending"] is not None, "fifteen years always end somehow"
    assert js == py


def test_a_trusted_advisor_retires(content):
    state = starting_state(5)
    state["standing"]["dons_trust"] = 95
    js, py = run_js(state, 5, 180, content, "faithful"), run_py(state, 5, 180, "faithful")
    assert py["state"]["ending"]["id"].startswith("retired")
    assert js == py


def test_broke_family_matches(content):
    state = starting_state(7)
    state["families"]["ferrante"]["treasury"] = 0
    for racket in state["rackets"].values():
        racket["income"] //= 4
    state["rackets"]["docks_pier_9"]["capo_id"] = None
    js, py = run_js(state, 7, 36, content), run_py(state, 7, 36)
    assert any(line["note"] == "unpaid" for e in py["state"]["knowledge"]["ledger"] for line in e["expenses"])
    assert js == py


def test_bundle_scenario_matches_engine(content):
    assert content["scenarios"]["default"] == starting_state(0)


def test_every_event_and_effect_kind_is_exercised_somewhere(content):
    """Parity only proves what the bots reach. Make sure they reach most of the content."""
    seen = set()
    trusted = starting_state(0)
    trusted["standing"]["dons_trust"] = 95
    for seed in range(40):
        if seed % 4 == 0:
            state = run_py(trusted, seed, 180, "faithful")["state"]
        else:
            state = run_py(None, seed, 60 if seed % 2 else 180, "cycle" if seed % 2 else "faithful")["state"]
        seen.update(d["matter_id"].rsplit("-", 1)[0] for d in state["knowledge"]["decisions"])
        seen.update(state["event_log"])
    rare = {e["id"] for e in content["events"] if e.get("rare")}  # fallbacks and tutorial-only, tested on their own
    matters = {e["id"] for e in content["events"] if e["kind"] == "matter" and not e.get("followup_only")}
    assert matters - rare <= seen


def test_a_silent_advisor_matches_too(content):
    js, py = run_js(None, 11, 180, content, "silent"), run_py(None, 11, 180, "silent")
    assert js == py


@pytest.mark.parametrize("difficulty", ["easy", "hard"])
def test_difficulty_and_tutorial_match(difficulty, content):
    js = run_js(None, 21, 120, content, "faithful", difficulty=difficulty, tutorial=True)
    py = run_py(None, 21, 120, "faithful", difficulty=difficulty, tutorial=True)
    assert py["state"]["difficulty"] == difficulty and "first_morning" in py["state"]["event_log"]
    assert js == py
