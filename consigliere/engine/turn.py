"""The monthly tick: run each system in a fixed order, then advance the calendar."""

from __future__ import annotations

from collections.abc import Sequence

from .rng import GameRNG
from .state import WorldState
from .systems import SYSTEMS, System


def tick(state: WorldState, rng: GameRNG, systems: Sequence[System] | None = None) -> None:
    for system in SYSTEMS if systems is None else systems:
        system(state, rng)
    state.month += 1
