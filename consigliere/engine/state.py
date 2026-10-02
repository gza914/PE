"""WorldState: the single source of truth, plus save/load with schema migrations."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import Field

from .models import (
    Character,
    Family,
    Investigation,
    LedgerEntry,
    Model,
    Racket,
    Relationship,
    Report,
    Standing,
)
from .rng import GameRNG, RNGState

SCHEMA_VERSION = 2

Migration = Callable[[dict[str, Any]], dict[str, Any]]



def _v1_to_v2(data: dict[str, Any]) -> dict[str, Any]:
    """Milestone 2: ledger and impressions in PlayerKnowledge, racket names."""
    knowledge = data.setdefault("knowledge", {})
    knowledge.setdefault("ledger", [])
    knowledge.setdefault("impressions", {})
    for racket in data.get("rackets", {}).values():
        racket.setdefault("name", racket["kind"].replace("_", " ").title())
    return data


# MIGRATIONS[n] upgrades a save from version n to n + 1.
MIGRATIONS: dict[int, Migration] = {1: _v1_to_v2}


class PlayerKnowledge(Model):
    """What the player believes. The UI reads only this, never the truth."""

    reports: list[Report] = Field(default_factory=list)
    ledger: list[LedgerEntry] = Field(default_factory=list)
    # character id -> loyalty band id the player currently believes
    impressions: dict[str, str] = Field(default_factory=dict)

    def reports_for(self, month: int) -> list[Report]:
        return [r for r in self.reports if r.month == month]

    def ledger_for(self, month: int) -> LedgerEntry | None:
        return next((e for e in reversed(self.ledger) if e.month == month), None)


class WorldState(Model):
    schema_version: int = SCHEMA_VERSION
    seed: int
    rng_state: RNGState | None = None
    month: int = 0
    player_id: str
    families: dict[str, Family] = Field(default_factory=dict)
    characters: dict[str, Character] = Field(default_factory=dict)
    relationships: list[Relationship] = Field(default_factory=list)
    rackets: dict[str, Racket] = Field(default_factory=dict)
    investigations: dict[str, Investigation] = Field(default_factory=dict)
    standing: Standing = Field(default_factory=Standing)
    knowledge: PlayerKnowledge = Field(default_factory=PlayerKnowledge)

    @property
    def player(self) -> Character:
        return self.characters[self.player_id]

    @property
    def player_family(self) -> Family:
        return self.families[self.player.family_id]

    def members(self, family_id: str) -> list[Character]:
        return [self.characters[i] for i in self.families[family_id].member_ids]


class SaveError(Exception):
    pass


def migrate(
    data: dict[str, Any],
    target: int = SCHEMA_VERSION,
    migrations: dict[int, Migration] | None = None,
) -> dict[str, Any]:
    """Upgrade raw save data one version at a time until it reaches target."""
    migrations = MIGRATIONS if migrations is None else migrations
    data = json.loads(json.dumps(data))  # deep copy; migrations may edit in place
    version = data.get("schema_version", 0)
    if version > target:
        raise SaveError(f"Save is from a newer version ({version} > {target}).")
    while version < target:
        if version not in migrations:
            raise SaveError(f"No migration from schema version {version}.")
        data = migrations[version](data)
        version += 1
        data["schema_version"] = version
    return data


def to_json(state: WorldState, rng: GameRNG) -> str:
    snapshot = state.model_copy(update={"rng_state": rng.get_state()})
    return snapshot.model_dump_json(indent=2)


def from_json(text: str) -> tuple[WorldState, GameRNG]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SaveError(f"Save file is not valid JSON: {exc}") from exc
    state = WorldState.model_validate(migrate(data))
    rng = GameRNG.from_state(state.rng_state) if state.rng_state else GameRNG(state.seed)
    return state, rng


def save_game(state: WorldState, rng: GameRNG, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(to_json(state, rng), encoding="utf-8")


def load_game(path: str | Path) -> tuple[WorldState, GameRNG]:
    return from_json(Path(path).read_text(encoding="utf-8"))
