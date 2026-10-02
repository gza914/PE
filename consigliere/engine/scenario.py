"""Builds a new game from a starting scenario in content/scenarios/."""

from __future__ import annotations

from .content import load_yaml
from .rng import GameRNG
from .state import WorldState
from .systems.observation import initial_impressions


def load_scenario(name: str, seed: int) -> WorldState:
    data = load_yaml(f"scenarios/{name}.yaml")
    data["families"] = {f["id"]: f for f in data.get("families", [])}
    data["characters"] = {c["id"]: c for c in data.get("characters", [])}
    data["rackets"] = {r["id"]: r for r in data.get("rackets", [])}
    state = WorldState.model_validate({**data, "seed": seed})
    initial_impressions(state)
    return state


def new_game(seed: int, scenario: str = "default") -> tuple[WorldState, GameRNG]:
    return load_scenario(scenario, seed), GameRNG(seed)
