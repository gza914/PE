"""Builds a new game from a starting scenario in content/scenarios/."""

from __future__ import annotations

from pathlib import Path

import yaml

from .rng import GameRNG
from .state import WorldState

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"


def load_scenario(name: str, seed: int) -> WorldState:
    path = CONTENT_DIR / "scenarios" / f"{name}.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data["families"] = {f["id"]: f for f in data.get("families", [])}
    data["characters"] = {c["id"]: c for c in data.get("characters", [])}
    data["rackets"] = {r["id"]: r for r in data.get("rackets", [])}
    return WorldState.model_validate({**data, "seed": seed})


def new_game(seed: int, scenario: str = "default") -> tuple[WorldState, GameRNG]:
    return load_scenario(scenario, seed), GameRNG(seed)
