"""Player commands. The UI sends these; only the engine changes state."""

from __future__ import annotations

from typing import Literal, Union

from .matters import WAIT, can_verify, verify
from .models import Model
from .rng import GameRNG
from .state import WorldState
from .turn import tick


class EndMonth(Model):
    kind: Literal["end_month"] = "end_month"


class Recommend(Model):
    """Put your advice on record for a matter: an option id, "wait", or None to keep quiet."""

    kind: Literal["recommend"] = "recommend"
    matter_id: str
    choice: str | None


class Verify(Model):
    """Spend Influence to hear what another source says about one piece of intel on a matter."""

    kind: Literal["verify"] = "verify"
    matter_id: str
    intel_index: int


Command = Union[EndMonth, Recommend, Verify]


class CommandError(ValueError):
    pass


def apply(state: WorldState, rng: GameRNG, command: Command) -> None:
    if isinstance(command, EndMonth):
        tick(state, rng)
    elif isinstance(command, Recommend):
        try:
            matter = state.matter(command.matter_id)
        except KeyError:
            raise CommandError(f"No matter {command.matter_id!r} on your desk.") from None
        allowed = {o.id for o in matter.options} | ({WAIT} if matter.can_wait else set())
        if command.choice is not None and command.choice not in allowed:
            raise CommandError(f"{command.choice!r} is not an option for {matter.title!r}.")
        matter.recommendation = command.choice
    elif isinstance(command, Verify):
        try:
            matter = state.matter(command.matter_id)
        except KeyError:
            raise CommandError(f"No matter {command.matter_id!r} on your desk.") from None
        if not 0 <= command.intel_index < len(matter.intel):
            raise CommandError("No such piece of intel.")
        if not can_verify(state, matter, command.intel_index):
            raise CommandError("You can't check that further: no other source, or not enough Influence.")
        verify(state, rng, matter, command.intel_index)
    else:
        raise CommandError(f"Unknown command: {command!r}")
