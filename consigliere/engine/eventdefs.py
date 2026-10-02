"""Schema for content/events/*.yaml. One event per file.

Conditions are three-item lists: [left, op, right].
  left:  a path such as "treasury", "dons_trust", "don_mood", "month", "flag.promised_pier",
         "capo.loyalty", "capo.age", "capo.stash", "capo.rackets", "racket.income",
         or a bare binding name for the ops "has" / "lacks" (traits and vices).
  op:    < <= > >= == != has lacks
  right: a number, a string, or another path.
Inside a cast slot's "where", "self" is the candidate.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from .models import Model, Role, Unit

OPS = {"<", "<=", ">", ">=", "==", "!=", "has", "lacks"}
STATS = ("loyalty", "fear", "respect", "competence", "greed", "discretion")
SPECIAL_WHO = {"crew", "don", "you"}
Condition = list[Any]


def check_conditions(conditions: list[Condition]) -> list[Condition]:
    for cond in conditions:
        if len(cond) != 3 or cond[1] not in OPS:
            raise ValueError(f"bad condition {cond!r}; expected [left, op, right] with op in {sorted(OPS)}")
    return conditions


class CastSlot(Model):
    """Who or what an event is about, picked at random among the candidates that fit.

    A character slot has a role (and optionally `runs`: he runs the racket in that slot).
    A racket slot has `racket: true`, or `racket_of` / `racket_not_of` an earlier character slot.
    """

    role: list[Role] | None = None
    runs: str | None = None
    racket: bool = False
    racket_of: str | None = None
    racket_not_of: str | None = None
    where: list[Condition] = Field(default_factory=list)

    _check = field_validator("where")(check_conditions)

    @model_validator(mode="after")
    def one_kind(self) -> CastSlot:
        if (self.role is not None) == self.is_racket:
            raise ValueError("a cast slot is either a character (role) or a racket")
        if self.is_racket and self.runs is not None:
            raise ValueError("runs applies to character slots")
        return self

    @property
    def is_racket(self) -> bool:
        return self.racket or self.racket_of is not None or self.racket_not_of is not None


class StatEffect(Model):
    who: str
    stat: Literal["loyalty", "fear", "respect", "competence", "greed", "discretion"]
    delta: int


class MemoryEffect(Model):
    who: str
    about: str  # a binding, "family", "don" or "you"
    weight: float
    decay: Unit = 0.05


class StandingEffect(Model):
    dons_trust: int = 0
    influence: int = 0
    exposure: int = 0


class AssignRacket(Model):
    racket: str
    to: str | None


class RacketIncome(Model):
    racket: str
    pct: int


class Followup(Model):
    event: str
    after: tuple[int, int]  # months, inclusive range
    when: list[Condition] = Field(default_factory=list)

    _check = field_validator("when")(check_conditions)


class AddExpense(Model):
    id: str
    label: str
    amount: int = Field(ge=0)
    stipend: bool = False


class ChangeExpense(Model):
    id: str
    delta: int


class Effect(Model):
    """Exactly one field is set."""

    stat: StatEffect | None = None
    memory: MemoryEffect | None = None
    standing: StandingEffect | None = None
    treasury: int | None = None
    don_mood: int | None = None
    cohesion: int | None = None
    assign_racket: AssignRacket | None = None
    racket_income: RacketIncome | None = None
    flag: str | None = None
    clear_flag: str | None = None
    followup: Followup | None = None
    add_expense: AddExpense | None = None
    change_expense: ChangeExpense | None = None
    remove_expense: str | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> Effect:
        set_fields = [name for name in type(self).model_fields if getattr(self, name) is not None]
        if len(set_fields) != 1:
            raise ValueError(f"an effect sets exactly one thing, got {set_fields or 'nothing'}")
        return self

    @property
    def kind(self) -> str:
        return next(name for name in type(self).model_fields if getattr(self, name) is not None)


class WeightMod(Model):
    when: list[Condition]
    mult: float = Field(ge=0)

    _check = field_validator("when")(check_conditions)


class Outcome(Model):
    weight: float = Field(default=1.0, ge=0)
    weight_if: list[WeightMod] = Field(default_factory=list)
    tone: Literal["good", "bad", "neutral"]
    text: str
    effects: list[Effect] = Field(default_factory=list)


class OptionDef(Model):
    id: str
    label: str
    don: dict[str, float] = Field(default_factory=dict)  # "base" and trait names -> appeal to the Don
    advised_exposure: int = 0  # your name is on it if he follows your advice
    outcomes: list[Outcome] = Field(min_length=1)

    @field_validator("id")
    @classmethod
    def not_reserved(cls, value: str) -> str:
        if value == "wait":
            raise ValueError('"wait" is reserved')
        return value


class EventDef(Model):
    id: str
    kind: Literal["matter", "news"] = "matter"
    title: str
    text: str
    cast: dict[str, CastSlot] = Field(default_factory=dict)
    trigger: list[Condition] = Field(default_factory=list)
    weight: float = Field(default=1.0, ge=0)
    cooldown: int = Field(default=12, ge=0)
    once: bool = False
    followup_only: bool = False
    patience: int = Field(default=1, ge=0)  # months the Don will let it wait
    options: list[OptionDef] = Field(default_factory=list)
    effects: list[Effect] = Field(default_factory=list)  # news only

    _check = field_validator("trigger")(check_conditions)

    @model_validator(mode="after")
    def shape(self) -> EventDef:
        if self.kind == "matter" and not 2 <= len(self.options) <= 4:
            raise ValueError("a matter has 2 to 4 options")
        if self.kind == "news" and self.options:
            raise ValueError("news has effects, not options")
        ids = [o.id for o in self.options]
        if len(ids) != len(set(ids)):
            raise ValueError("option ids must be unique")
        return self

    def option(self, option_id: str) -> OptionDef:
        return next(o for o in self.options if o.id == option_id)
