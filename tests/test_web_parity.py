"""The web engine (web/engine.js) must play the same game as the Python engine."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from consigliere.engine.rng import GameRNG
from consigliere.engine.scenario import load_scenario
from consigliere.engine.state import WorldState
from consigliere.engine.turn import tick
from tools.build_web import content_bundle

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

RUNNER = """
const E = require(process.argv[1]);
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const rng = new E.GameRNG(input.seed);
const state = input.state;
for (let i = 0; i < input.months; i++) E.tick(state, rng, input.content);
process.stdout.write(JSON.stringify({ state, probe: rng.random() }));
"""


def run_js(state: dict, seed: int, months: int, content: dict) -> dict:
    payload = json.dumps({"state": state, "seed": seed, "months": months, "content": content})
    out = subprocess.run(
        [NODE, "-e", RUNNER, str(ROOT / "web" / "engine.js")],
        input=payload, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def run_py(state: dict, seed: int, months: int) -> dict:
    world, rng = WorldState.model_validate(state), GameRNG(seed)
    for _ in range(months):
        tick(world, rng)
    return {"state": world.model_dump(mode="json"), "probe": rng.random()}


def starting_state(seed: int) -> dict:
    return load_scenario("default", seed).model_dump(mode="json")


@pytest.fixture(scope="module")
def content():
    return content_bundle()


@pytest.mark.parametrize("seed", [0, 1234, 2**32 - 1])
def test_same_seed_same_decade(seed, content):
    state = starting_state(seed)
    assert run_js(state, seed, 120, content) == run_py(state, seed, 120)


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
