"""Monthly systems.

turn.tick runs SYSTEMS in order to close the month, advances the calendar, then runs
MONTH_START to open the next one. Each is a function (state, rng) -> None.
Planned once complete: economy, decisions, heat, law, conflict, characters, aging, information.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from .. import matters
from . import characters, economy, observation

if TYPE_CHECKING:
    from ..rng import GameRNG
    from ..state import WorldState

System = Callable[["WorldState", "GameRNG"], None]

# Economy runs before decisions so money a decision moves lands in this month's books.
SYSTEMS: list[System] = [economy.run, matters.run, characters.run, observation.run]
MONTH_START: list[System] = [matters.begin_month]
