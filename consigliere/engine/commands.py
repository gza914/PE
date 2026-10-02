"""Player commands. The UI sends these; only the engine changes state."""

from __future__ import annotations

from typing import Literal, Union

from .matters import WAIT, can_verify, verify
from .world import SITDOWN_ACTIONS, sitdown_act
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


class SitDownAct(Model):
    """One move at the table: concede, hold, threaten, or walk."""

    kind: Literal["sitdown"] = "sitdown"
    action: str


Command = Union[EndMonth, Recommend, Verify, SitDownAct]


class CommandError(ValueError):
    pass


def apply(state: WorldState, rng: GameRNG, command: Command) -> None:
    if state.ending is not None:
        raise CommandError("The story is over.")
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
    elif isinstance(command, SitDownAct):
        if state.sitdown is None:
            raise CommandError("There is no sit-down under way.")
        if command.action not in SITDOWN_ACTIONS:
            raise CommandError(f"{command.action!r} is not something you can do at the table.")
        sitdown_act(state, command.action)
    else:
        raise CommandError(f"Unknown command: {command!r}")
