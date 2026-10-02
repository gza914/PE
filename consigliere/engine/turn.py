"""The monthly tick: close the month, advance the calendar, open the next month."""

from __future__ import annotations

from collections.abc import Sequence

from .rng import GameRNG
from .state import WorldState
from .systems import MONTH_START, SYSTEMS, System


def tick(
    state: WorldState,
    rng: GameRNG,
    systems: Sequence[System] | None = None,
    month_start: Sequence[System] | None = None,
) -> None:
    if state.ending is not None:
        return  # the story is over
    for system in SYSTEMS if systems is None else systems:
        system(state, rng)
    if state.ending is not None:
        return
    state.month += 1
    for system in MONTH_START if month_start is None else month_start:
        system(state, rng)
