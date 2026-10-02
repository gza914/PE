"""Player commands. The UI sends these; only the engine changes state."""

from __future__ import annotations

from typing import Literal, Union

from .models import Model
from .rng import GameRNG
from .state import WorldState
from .turn import tick


class EndMonth(Model):
    kind: Literal["end_month"] = "end_month"


Command = Union[EndMonth]


def apply(state: WorldState, rng: GameRNG, command: Command) -> None:
    if isinstance(command, EndMonth):
        tick(state, rng)
    else:
        raise ValueError(f"Unknown command: {command!r}")
