"""Monthly systems, run by turn.tick in the order listed in SYSTEMS.

Each system is a function (state, rng) -> None.
Planned order once complete: economy, heat, law, conflict, characters (relationships,
loyalty), aging, information.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from . import characters, economy, observation

if TYPE_CHECKING:
    from ..rng import GameRNG
    from ..state import WorldState

System = Callable[["WorldState", "GameRNG"], None]

SYSTEMS: list[System] = [economy.run, characters.run, observation.run]
