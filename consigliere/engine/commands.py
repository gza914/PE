"""Player commands. The UI sends these; only the engine changes state."""

from __future__ import annotations

from typing import Literal, Union

from .matters import WAIT, can_flag, can_propose, can_talk, can_verify, flag_books, option_open, propose, talk, verify
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


class Talk(Model):
    """Say one of the lines open to you in one conversation on a primary issue."""

    kind: Literal["talk"] = "talk"
    matter_id: str
    talk: int
    line: int


class SitDownAct(Model):
    """One move at the table: concede, hold, threaten, or walk."""

    kind: Literal["sitdown"] = "sitdown"
    action: str


class Note(Model):
    """Your own note on someone. Empty text removes it."""

    kind: Literal["note"] = "note"
    character_id: str
    text: str


class Pin(Model):
    kind: Literal["pin"] = "pin"
    character_id: str
    pinned: bool


class FlagBooks(Model):
    """Bring the Don the numbers on a capo whose envelopes look light."""

    kind: Literal["flag_books"] = "flag_books"
    capo_id: str


class ProposeReassign(Model):
    """Put it to the Don that a racket should go to another capo."""

    kind: Literal["propose"] = "propose"
    racket_id: str
    capo_id: str


NOTE_LIMIT = 500

Command = Union[EndMonth, Recommend, Verify, Talk, SitDownAct, Note, Pin, FlagBooks, ProposeReassign]


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
        option = next((o for o in matter.options if o.id == command.choice), None)
        if option is not None and not option_open(matter, option):
            raise CommandError("You don't know enough yet to put that to the Don.")
        matter.recommendation = command.choice
    elif isinstance(command, Talk):
        try:
            matter = state.matter(command.matter_id)
        except KeyError:
            raise CommandError(f"No matter {command.matter_id!r} on your desk.") from None
        if not can_talk(state, matter, command.talk, command.line):
            raise CommandError("You can't say that now.")
        talk(state, rng, matter, command.talk, command.line)
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
    elif isinstance(command, Note):
        if command.character_id not in state.characters:
            raise CommandError("Nobody by that name.")
        text = command.text.strip()[:NOTE_LIMIT]
        if text:
            state.knowledge.notes[command.character_id] = text
        else:
            state.knowledge.notes.pop(command.character_id, None)
    elif isinstance(command, Pin):
        if command.character_id not in state.characters:
            raise CommandError("Nobody by that name.")
        pinned = [p for p in state.knowledge.pinned if p != command.character_id]
        state.knowledge.pinned = pinned + ([command.character_id] if command.pinned else [])
    elif isinstance(command, FlagBooks):
        if not can_flag(state, command.capo_id):
            raise CommandError("You can't bring the Don his numbers right now.")
        flag_books(state, rng, command.capo_id)
    elif isinstance(command, ProposeReassign):
        if not can_propose(state, command.racket_id, command.capo_id):
            raise CommandError("That move can't be proposed.")
        propose(state, rng, command.racket_id, command.capo_id)
    else:
        raise CommandError(f"Unknown command: {command!r}")
