"""Monthly systems, run by turn.tick in the order listed in SYSTEMS.

Each system is a function (state, rng) -> None. Milestone 1 has none yet.
Planned order: economy, heat, law, conflict, relationships, aging, information.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..rng import GameRNG
    from ..state import WorldState

System = Callable[["WorldState", "GameRNG"], None]

SYSTEMS: list[System] = []
