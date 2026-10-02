"""The web engine (web/engine.js) must play the same game as the Python engine."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from consigliere.engine.commands import Recommend, Verify, apply
from consigliere.engine.matters import can_verify
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
if (input.fresh) ({ state, rng } = E.newGame(input.content, input.seed));
else { state = input.state; rng = new E.GameRNG(input.seed); }
for (let i = 0; i < input.months; i++) {
  state.matters.forEach((m, j) => {
    m.intel.forEach((_, i) => {
      if ((state.month + i + j) % 2 === 0 && E.canVerify(state, m, i, input.content)) E.verify(state, rng, m.id, i, input.content);
    });
    const choices = m.options.map((o) => o.id).concat(m.can_wait ? ["wait"] : [], [null]);
    E.recommend(state, m.id, choices[(state.month * 7 + j * 3) % choices.length]);
  });
  E.tick(state, rng, input.content);
}
process.stdout.write(JSON.stringify({ state, probe: rng.random() }));
"""


def bot_choice(state: WorldState, matter, index: int):
    """The same deterministic advisor as the JS runner: cycles through every kind of advice."""
    choices = [o.id for o in matter.options] + (["wait"] if matter.can_wait else []) + [None]
    return choices[(state.month * 7 + index * 3) % len(choices)]


def run_js(state: dict | None, seed: int, months: int, content: dict) -> dict:
    payload = json.dumps({"state": state, "fresh": state is None, "seed": seed, "months": months, "content": content})
    out = subprocess.run(
        [NODE, "-e", RUNNER, str(ROOT / "web" / "engine.js")],
        input=payload, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def run_py(state: dict | None, seed: int, months: int) -> dict:
    if state is None:
        world, rng = new_game(seed)
    else:
        world, rng = WorldState.model_validate(state), GameRNG(seed)
    for _ in range(months):
        for j, matter in enumerate(world.matters):
            for i in range(len(matter.intel)):
                if (world.month + i + j) % 2 == 0 and can_verify(world, matter, i):
                    apply(world, rng, Verify(matter_id=matter.id, intel_index=i))
            apply(world, rng, Recommend(matter_id=matter.id, choice=bot_choice(world, matter, j)))
        tick(world, rng)
    return {"state": world.model_dump(mode="json"), "probe": rng.random()}


def starting_state(seed: int) -> dict:
    return load_scenario("default", seed).model_dump(mode="json")


@pytest.fixture(scope="module")
def content():
    return content_bundle()


@pytest.mark.parametrize("seed", [0, 1234, 2**32 - 1, 77, 31337])
def test_same_seed_same_decade(seed, content):
    js, py = run_js(None, seed, 120, content), run_py(None, seed, 120)
    assert py["state"]["knowledge"]["decisions"], "the bot should have settled some matters"
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
    for seed in range(40):
        state = run_py(None, seed, 60)["state"]
        seen.update(d["matter_id"].rsplit("-", 1)[0] for d in state["knowledge"]["decisions"])
        seen.update(state["event_log"])
    matters = {e["id"] for e in content["events"] if e["kind"] == "matter" and not e.get("followup_only")}
    assert matters <= seen
