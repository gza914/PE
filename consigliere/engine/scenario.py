"""Builds a new game from a starting scenario in content/scenarios/."""

from __future__ import annotations

from .content import load_yaml
from .matters import begin_month
from .rng import GameRNG
from .state import WorldState
from .systems.observation import initial_impressions


def load_scenario(name: str, seed: int) -> WorldState:
    data = load_yaml(f"scenarios/{name}.yaml")
    data["families"] = {f["id"]: f for f in data.get("families", [])}
    data["characters"] = {c["id"]: c for c in data.get("characters", [])}
    data["rackets"] = {r["id"]: r for r in data.get("rackets", [])}
    data["districts"] = {d["id"]: d for d in data.get("districts", [])}
    data["rivalries"] = {r["family_id"]: r for r in data.get("rivalries", [])}
    sources = data.pop("sources", [])
    data["sources"] = {
        s["id"]: {k: s[k] for k in ("id", "name", "kind", "reliability")} | {"character_id": s.get("character")}
        for s in sources
    }
    data.setdefault("knowledge", {})["sources"] = {
        s["id"]: {"name": s["name"], "kind": s["kind"], "believed": s["believed"]} for s in sources
    }
    state = WorldState.model_validate({**data, "seed": seed})
    state.knowledge.dons = [state.characters[state.player_family.don_id].name]
    initial_impressions(state)
    return state


def new_game(seed: int, scenario: str = "default") -> tuple[WorldState, GameRNG]:
    """The starting state is the same for every seed; the first month's matters are not."""
    state, rng = load_scenario(scenario, seed), GameRNG(seed)
    begin_month(state, rng)
    return state, rng
