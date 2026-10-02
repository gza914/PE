"""Schema for content/events/*.yaml. One event per file.

Conditions are three-item lists: [left, op, right], or {any: [conditions]} for "at least one".
  left:  a path such as "treasury", "dons_trust", "don_mood", "month", "flag.promised_pier",
         "secret.inside_job", "capo.loyalty", "capo.age", "capo.stash", "capo.rackets",
         "capo.allegiance", "racket.income", or a bare binding name for "has" / "lacks"
         (traits and vices).
  op:    < <= > >= == != has lacks
  right: a number, a string, or another path.
Inside a cast slot's "where", "self" is the candidate.

Secrets are coin flips made when a matter arises ({name: probability}); conditions read them as
"secret.name". They travel with the bindings to follow-ups, so a whole arc shares them.

Intel is what your sources tell you about a matter: a claim, its denial, the condition that makes
the claim true, and the kinds of source that would know. Each source reports the truth with its
hidden reliability; a compromised source always reports the opposite.

Lists render several cast members as one sorted phrase, so text never reveals slot order:
lists: {suspects: [a, b, c]} makes {suspects} read "Augie Sabella, Frank Tessaro and Leo Marchetti".
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from .models import Allegiance, Model, Role, Unit

OPS = {"<", "<=", ">", ">=", "==", "!=", "has", "lacks"}
STATS = ("loyalty", "fear", "respect", "competence", "greed", "discretion")
SPECIAL_WHO = {"crew", "don", "you"}
Condition = Any  # [left, op, right] or {"any": [conditions]}


def check_conditions(conditions: list[Condition]) -> list[Condition]:
    for cond in conditions:
        if isinstance(cond, dict):
            if set(cond) != {"any"} or not isinstance(cond["any"], list):
                raise ValueError(f"bad condition {cond!r}; the only mapping form is {{any: [conditions]}}")
            check_conditions(cond["any"])
        elif not isinstance(cond, list) or len(cond) != 3 or cond[1] not in OPS:
            raise ValueError(f"bad condition {cond!r}; expected [left, op, right] with op in {sorted(OPS)}")
    return conditions


class CastSlot(Model):
    """Who or what an event is about, picked at random among the candidates that fit.

    A character slot has a role (and optionally `runs`: he runs the racket in that slot).
    A racket slot has `racket: true`, or `racket_of` / `racket_not_of` an earlier character slot.
    """

    role: list[Role] | None = None
    runs: str | None = None
    investigated: bool = False  # a man of yours the government is watching, as far as you know
    boss_of: str | None = None  # the boss of the rival family in that slot
    racket: bool = False
    racket_of: str | None = None
    racket_not_of: str | None = None
    racket_in: str | None = None  # a racket in the district in that slot
    rival: bool = False  # a rival family
    district_of: str | None = None  # a district held by the family in that slot, or "family" for yours
    where: list[Condition] = Field(default_factory=list)

    _check = field_validator("where")(check_conditions)

    @property
    def kind(self) -> str:
        if self.rival:
            return "family"
        if self.district_of is not None:
            return "district"
        if self.is_racket:
            return "racket"
        return "character"

    @model_validator(mode="after")
    def one_kind(self) -> CastSlot:
        kinds = [self.role is not None or self.investigated or self.boss_of is not None, self.is_racket,
                 self.rival, self.district_of is not None]
        if sum(kinds) != 1:
            raise ValueError("a cast slot is exactly one of: a character, a racket, a rival family, a district")
        if self.kind != "character" and self.runs is not None:
            raise ValueError("runs applies to character slots")
        return self

    @property
    def is_racket(self) -> bool:
        return self.racket or self.racket_of is not None or self.racket_not_of is not None or self.racket_in is not None


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


class AllegianceEffect(Model):
    who: str
    to: Allegiance
    agency: str | None = None


class SourceDef(Model):
    """A new source of information. `character` is a cast slot if the source is a person in the story."""

    id: str
    name: str
    kind: str
    reliability: Unit  # hidden: how often he reports the truth
    believed: Unit  # how far you trust him at first
    character: str | None = None


class AssignRoles(Model):
    """Shuffle the characters in `pool` into new binding names, one per role."""

    pool: list[str]
    roles: list[str]

    @model_validator(mode="after")
    def same_length(self) -> AssignRoles:
        if len(self.pool) != len(self.roles):
            raise ValueError("assign_roles needs one role per pool slot")
        return self


class AddVice(Model):
    who: str
    vice: str


class HealthEffect(Model):
    who: str
    delta: int


class RivalryEffect(Model):
    who: str  # a rival family slot
    stage: int = 0  # steps up (or down) the ladder
    set_stage: int | None = Field(default=None, ge=0, le=5)
    tension: int = 0


class TransferDistrict(Model):
    district: str
    to: str  # a family slot, or "family" for yours


class Defect(Model):
    who: str
    to: str  # a rival family slot


class FamilyDelta(Model):
    who: str  # "family" for yours, or a rival family slot
    delta: int


class InvestigationEffect(Model):
    who: str
    progress: int


class SuccessionEffect(Model):
    """The capos choose a new Don among the candidates; binds "winner"."""

    candidates: list[str]
    backed: str | None = None


class RecruitEffect(Model):
    """A soldier is made a capo: a new man from content/recruits.yaml, bound to `bind`."""

    profile: str
    bind: str


class AddRacket(Model):
    """A new racket for your family, in the district bound to `district`, bound as `bind`."""

    id: str
    name: str
    kind: str
    district: str
    capo: str | None = None
    income: int
    heat_per_month: int
    bind: str


class Promote(Model):
    who: str
    role: Role


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
    allegiance: AllegianceEffect | None = None
    add_source: SourceDef | None = None
    compromise_source: str | None = None
    remove_source: str | None = None
    assign_roles: AssignRoles | None = None
    add_vice: AddVice | None = None
    retire: str | None = None  # he is gone from the family: dead, jailed, or far away
    health: HealthEffect | None = None
    rivalry: RivalryEffect | None = None
    transfer_district: TransferDistrict | None = None
    strength: FamilyDelta | None = None
    heat: FamilyDelta | None = None
    sitdown: str | None = None  # open a sit-down with the rival family in that slot
    investigation: InvestigationEffect | None = None
    drop_investigation: str | None = None
    unassign: str | None = None  # take every racket away from him; they run unattended
    kill: str | None = None  # off the page, always
    succession: SuccessionEffect | None = None
    recruit: RecruitEffect | None = None
    add_racket: AddRacket | None = None
    remove_racket: str | None = None
    promote: Promote | None = None
    defect: Defect | None = None  # he goes over to a rival family, rackets and all

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
    headline: str | None = None  # what the Herald prints, if it gets out
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


class IntelDef(Model):
    about: str | None = None  # the cast slot it concerns; he is never asked about himself
    claim: str
    denial: str
    truth: list[Condition]
    sources: list[str] = Field(min_length=1)  # source kinds that would know
    reveal: Unit | None = None  # chance the truth comes out once settled; default from balance

    _check = field_validator("truth")(check_conditions)


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
    arise_effects: list[Effect] = Field(default_factory=list)  # applied the moment it reaches your desk
    secrets: dict[str, Unit] = Field(default_factory=dict)
    intel: list[IntelDef] = Field(default_factory=list)
    lists: dict[str, list[str]] = Field(default_factory=dict)
    carries: list[str] = Field(default_factory=list)  # binding names a follow-up inherits from earlier events
    even_if_gone: bool = False  # news that still runs when the people it names are out of play
    rare: bool = False  # a fallback that may legitimately never fire in a balance run
    headline: str | None = None  # for news: what the Herald prints
    you_decide: bool = False  # no Don to ask: your choice is the decision
    default_option: str | None = None  # what happens if you say nothing, when you decide

    _check = field_validator("trigger")(check_conditions)

    @model_validator(mode="after")
    def shape(self) -> EventDef:
        if self.kind == "matter" and not 2 <= len(self.options) <= 4:
            raise ValueError("a matter has 2 to 4 options")
        if self.kind == "news" and (self.options or self.intel):
            raise ValueError("news has effects, not options or intel")
        ids = [o.id for o in self.options]
        if len(ids) != len(set(ids)):
            raise ValueError("option ids must be unique")
        if self.you_decide and (self.default_option not in ids or self.patience != 0):
            raise ValueError("an event you decide needs a default_option among its options and patience 0")
        return self

    def option(self, option_id: str) -> OptionDef:
        return next(o for o in self.options if o.id == option_id)
