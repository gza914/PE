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
    stash: int = 0  # money skimmed and kept; the family never sees this


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
    alive: bool = True  # False once he is out of play: dead, jailed, or gone
    fate: str | None = None  # why he is out of play: died, killed, jailed, gone


class Relationship(Model):
    """Directed edge: how src feels about dst."""

    src: str
    dst: str
    trust: Signed = 0
    affection: Signed = 0
    fear: Score = 0
    debt: int = 0  # favors src owes dst


class Expense(Model):
    """A recurring monthly cost paid from the family treasury."""

    id: str
    label: str
    amount: int = Field(ge=0)
    stipend: bool = False  # missing a stipend payment costs loyalty
    until: int | None = None  # last month it is owed; None for as long as it lasts


class Family(Model):
    id: str
    name: str
    don_id: str
    member_ids: list[str] = Field(default_factory=list)
    strength: Score = 50
    wealth: Score = 50
    cohesion: Score = 50
    treasury: int = 0
    expenses: list[Expense] = Field(default_factory=list)
    heat: Score = 0  # how much attention the law pays the family as a whole


class District(Model):
    id: str
    name: str
    family_id: str


class Rivalry(Model):
    """Where things stand with a rival family, on the ladder from peace to open war."""

    family_id: str
    stage: int = Field(default=0, ge=0, le=5)  # 0 peace, 1 insult, 2 sit-down, 3 retaliation, 4 blood, 5 war
    tension: Score = 0
    war_months: int = 0


class SitDown(Model):
    """A negotiation in progress. The red line is never shown to the player."""

    rival_id: str
    month: int
    round: int = 1
    max_rounds: int
    ask: int  # the monthly tribute they are asking for now
    offer: int = 0  # what you have offered so far
    patience: int
    red_line: int
    log: list[str] = Field(default_factory=list)


class SitDownView(Model):
    """The sit-down as the player sees it across the table."""

    rival_id: str
    rival_name: str
    round: int
    max_rounds: int
    ask: int
    offer: int
    patience: int
    log: list[str] = Field(default_factory=list)


class KnownInvestigation(Model):
    target_id: str
    stage: str
    since: int  # month you learned of it


class Racket(Model):
    id: str
    name: str
    kind: RacketKind
    family_id: str
    capo_id: str | None = None
    district_id: str | None = None
    income: int = 0  # typical gross per month, before the capo's share
    heat_per_month: int = 0
    heat: int = 0


class Investigation(Model):
    id: str
    target_id: str
    agency: str
    stage: InvestigationStage = InvestigationStage.SURVEILLANCE
    progress: Score = 0
    opened_month: int


class LedgerLine(Model):
    label: str
    amount: int
    note: str = ""
    racket_id: str | None = None  # set on envelopes, so the books can be read racket by racket


class LedgerEntry(Model):
    """One month of the family's books, as the family sees them."""

    month: int
    kickups: list[LedgerLine] = Field(default_factory=list)
    expenses: list[LedgerLine] = Field(default_factory=list)
    other: list[LedgerLine] = Field(default_factory=list)  # signed; money moved by decisions
    treasury_start: int
    treasury_end: int

    @property
    def total_in(self) -> int:
        return sum(line.amount for line in self.kickups)

    @property
    def total_out(self) -> int:
        return sum(line.amount for line in self.expenses if not line.note)


class Report(Model):
    """A fact as the player knows it: sourced, dated, maybe wrong."""

    id: str
    subject_id: str
    claim: str
    source_id: str
    month: int
    confidence: Unit


class MatterOption(Model):
    id: str
    label: str


class IntelReport(Model):
    source_id: str
    says: bool  # True: the source backs the claim; False: the source denies it
    month: int


class MatterIntel(Model):
    claim: str
    denial: str
    about: str | None = None  # character id
    reports: list[IntelReport] = Field(default_factory=list)


class Matter(Model):
    """A decision on the consigliere's desk this month. Text is resolved when it arises."""

    id: str
    event_id: str
    month: int
    title: str
    text: str
    options: list[MatterOption]
    bindings: dict[str, str] = Field(default_factory=dict)  # cast name -> character or racket id
    waited: int = 0
    can_wait: bool = True
    recommendation: str | None = None  # option id, "wait", or None for silence
    intel: list[MatterIntel] = Field(default_factory=list)


class Scheduled(Model):
    """A follow-up event due in a later month, if its conditions still hold."""

    event_id: str
    month: int
    bindings: dict[str, str] = Field(default_factory=dict)
    when: list[list[Any]] = Field(default_factory=list)


class Decision(Model):
    """How a matter was settled, as the consigliere saw it."""

    month: int
    matter_id: str
    title: str
    recommended: str | None  # label of what you advised; None if you kept quiet
    chosen: str  # label of what the Don did
    followed: bool | None  # None when you kept quiet
    tone: str  # good, bad, neutral, or waiting
    text: str
    trust_delta: int = 0
    revealed: list[str] = Field(default_factory=list)  # what came out afterwards, and who had it right


class Source(Model):
    """The truth about a source of information. Never shown to the player."""

    id: str
    name: str
    kind: str
    reliability: Unit
    character_id: str | None = None
    compromised: bool = False
    active: bool = True


class KnownSource(Model):
    """A source as the player knows it: who he is, how far you trusted him at first, his record."""

    name: str
    kind: str
    believed: Unit
    right: int = 0
    wrong: int = 0
    active: bool = True


class NewsItem(Model):
    month: int
    title: str
    text: str


class Standing(Model):
    dons_trust: Score = 50
    influence: Score = 20
    exposure: Score = 0


class Memoir(Model):
    """The end-of-run summary of your career, from what you knew."""

    months: int
    dons: list[str] = Field(default_factory=list)
    matters: int
    advised: int
    taken: int
    went_well: int
    went_badly: int
    peak_treasury: int
    final_treasury: int
    districts: int
    rat_found: bool
    lost: list[str] = Field(default_factory=list)
    final_trust: int


class Ending(Model):
    id: str
    month: int
    rank: int  # 1 is the best way this can end
    title: str
    text: str
    memoir: Memoir


class Headline(Model):
    """A story in the Herald, the public view of what happened."""

    month: int
    text: str
    family: bool = False  # a story about the family's business, rather than the city's
