"""Pydantic models for everything in the world. Skeleton fields only; systems add more later."""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

Score = Annotated[int, Field(ge=0, le=100)]
Signed = Annotated[int, Field(ge=-100, le=100)]
Unit = Annotated[float, Field(ge=0.0, le=1.0)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Role(str, Enum):
    DON = "don"
    UNDERBOSS = "underboss"
    CONSIGLIERE = "consigliere"
    CAPO = "capo"
    SOLDIER = "soldier"
    ASSOCIATE = "associate"
    RIVAL_BOSS = "rival_boss"
    COP = "cop"
    PROSECUTOR = "prosecutor"
    POLITICIAN = "politician"
    UNION_BOSS = "union_boss"
    JOURNALIST = "journalist"
    FAMILY_MEMBER = "family_member"


class Trait(str, Enum):
    AMBITIOUS = "ambitious"
    LOYAL = "loyal"
    HOTHEAD = "hothead"
    GREEDY = "greedy"
    CAUTIOUS = "cautious"
    PIOUS = "pious"
    VAIN = "vain"
    PARANOID = "paranoid"
    SENTIMENTAL = "sentimental"


class Allegiance(str, Enum):
    FAMILY = "family"
    INFORMANT = "informant"
    RIVAL_PLANT = "rival_plant"


class RacketKind(str, Enum):
    NUMBERS = "numbers"
    LOANSHARKING = "loansharking"
    UNIONS = "unions"
    DOCKS = "docks"
    CONSTRUCTION = "construction"
    GAMBLING = "gambling"
    PROTECTION = "protection"
    NARCOTICS = "narcotics"


class InvestigationStage(str, Enum):
    SURVEILLANCE = "surveillance"
    INFORMANT_RECRUITMENT = "informant_recruitment"
    GRAND_JURY = "grand_jury"
    INDICTMENT = "indictment"


class Stats(Model):
    loyalty: Score = 50
    fear: Score = 50
    respect: Score = 50
    competence: Score = 50
    greed: Score = 50
    discretion: Score = 50


class HiddenState(Model):
    allegiance: Allegiance = Allegiance.FAMILY
    allegiance_to: str | None = None  # agency or family id when not FAMILY
    debts: int = 0
    vices: list[str] = Field(default_factory=list)
    health: Score = 100
    birth_year: int


class Memory(Model):
    event_id: str
    about_id: str | None = None
    month: int
    weight: float  # positive for favors, negative for slights
    decay_rate: Unit = 0.05  # fraction lost per month; betrayals use far lower values


class Character(Model):
    id: str
    name: str
    role: Role
    family_id: str | None = None
    traits: list[Trait] = Field(min_length=3, max_length=5)
    stats: Stats = Field(default_factory=Stats)
    hidden: HiddenState
    memory: list[Memory] = Field(default_factory=list)
    alive: bool = True


class Relationship(Model):
    """Directed edge: how src feels about dst."""

    src: str
    dst: str
    trust: Signed = 0
    affection: Signed = 0
    fear: Score = 0
    debt: int = 0  # favors src owes dst


class Family(Model):
    id: str
    name: str
    don_id: str
    member_ids: list[str] = Field(default_factory=list)
    strength: Score = 50
    wealth: Score = 50
    cohesion: Score = 50
    treasury: int = 0


class Racket(Model):
    id: str
    kind: RacketKind
    family_id: str
    capo_id: str | None = None
    income: int = 0  # per month
    heat_per_month: int = 0
    heat: int = 0


class Investigation(Model):
    id: str
    target_id: str
    agency: str
    stage: InvestigationStage = InvestigationStage.SURVEILLANCE
    progress: Score = 0
    opened_month: int


class Report(Model):
    """A fact as the player knows it: sourced, dated, maybe wrong."""

    id: str
    subject_id: str
    claim: str
    source_id: str
    month: int
    confidence: Unit


class EventOption(Model):
    id: str
    text: str
    effects: list[dict[str, Any]] = Field(default_factory=list)


class EventDef(Model):
    """Shape of a content/events YAML file. Not used until Milestone 3."""

    id: str
    trigger: dict[str, Any] = Field(default_factory=dict)
    weight: float = 1.0
    cooldown: int = 0
    text: str
    options: list[EventOption] = Field(min_length=2, max_length=4)


class Standing(Model):
    dons_trust: Score = 50
    influence: Score = 20
    exposure: Score = 0
