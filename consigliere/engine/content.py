"""Loads tuning numbers and flavor text from content/*.yaml."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import Field

from .eventdefs import EventDef
from .models import Model, Score, Trait, Unit

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"


def load_yaml(relative: str) -> Any:
    return yaml.safe_load((CONTENT_DIR / relative).read_text(encoding="utf-8"))


class EconomyBalance(Model):
    income_variance: Unit  # gross swings by up to this fraction either way
    competence_floor: float  # income multiplier at competence 0; competence 100 gives 2 - floor
    capo_share: Unit  # fraction of gross the capo keeps for his crew
    max_skim: Unit
    skim_trait_bonus: dict[Trait, float] = Field(default_factory=dict)
    skim_noise: Unit  # skim fraction varies by up to this fraction either way


class LoyaltyBalance(Model):
    base: Score
    don_respect_weight: float
    cohesion_weight: float
    trait_targets: dict[Trait, float] = Field(default_factory=dict)
    memory_cap: float
    drift_rate: Unit
    noise: float
    cohesion_drift_rate: Unit
    forget_below: float


class StipendBalance(Model):
    missed_memory_weight: float
    missed_decay_rate: Unit


class ObservationBalance(Model):
    base_notice: Unit
    indiscretion_weight: Unit  # added notice chance at discretion 0
    confidence: Unit


class MattersBalance(Model):
    per_month_min: int = Field(ge=0)
    per_month_max: int = Field(ge=0)


class TrustDeltas(Model):
    followed_good: int
    followed_bad: int
    followed_neutral: int
    ignored_good: int
    ignored_bad: int
    ignored_neutral: int


class AdviceBalance(Model):
    follow_base: float
    follow_trust_weight: float  # added chance at Don's Trust 100
    follow_mood_weight: float  # added chance at mood 100, subtracted at mood 0
    follow_traits: dict[Trait, float] = Field(default_factory=dict)
    follow_min: Unit
    follow_max: Unit
    don_noise: float  # randomness in the Don's own preference
    trust: TrustDeltas


class MoodBalance(Model):
    good: int
    bad: int
    neutral: int
    drift_rate: Unit


class InformationBalance(Model):
    verify_cost: int = Field(ge=0)  # Influence spent to hear from a second source
    prior_weight: float = Field(gt=0)  # how many reports your first impression of a source is worth
    reveal_chance: Unit  # chance the truth behind a claim comes out once a matter is settled
    monthly_influence: int  # Influence that accrues each month


class HeatBalance(Model):
    racket_decay: Unit
    family_follow: Unit
    war_heat: int


class LawBalance(Model):
    open_threshold: int
    open_scale: float = Field(gt=0)
    open_max: Unit
    base_progress: float
    pressure_divisor: float = Field(gt=0)
    decay: float
    rat_bonus: float
    turned_relief: float
    learn_base: Unit
    learn_police: Unit
    family_support: int


class RivalsBalance(Model):
    aggression: dict[Trait, float] = Field(default_factory=dict)
    aggression_weight: float
    strength_divisor: float = Field(gt=0)
    noise: float
    calm_rate: Unit
    base_strength: int
    regen_rate: Unit
    war_cost: int
    war_loss_min: int
    war_loss_max: int
    war_end_strength: int


class SitDownBalance(Model):
    max_rounds: int
    concession: int
    ask_drop: int
    hold_drop: int
    threat_drop: int
    threat_margin: int
    red_line_min: int
    red_line_max: int
    stronger_premium: int
    broke_discount: int
    broke_treasury: int
    opening_margin_min: int
    opening_margin_max: int
    patience: int
    good_deal_margin: int


class LifeBalance(Model):
    age_threshold: int
    age_rate: float  # monthly chance of a decline, per year of age over the threshold
    don_factor: float
    vice_rate: dict[str, float] = Field(default_factory=dict)
    decline_min: int
    decline_max: int
    spell_below: int
    spell_chance: Unit
    spell_min: int
    spell_max: int


class SuccessionBalance(Model):
    backing_bonus: float
    influence_weight: float
    keep_base: Unit
    keep_influence: float
    trust_backed_winner: int
    trust_neutral: int
    trust_backed_loser: int


class EndingsBalance(Model):
    last_month: int
    ruin_strength: int
    ruin_treasury: int
    exile_exposure: int
    intact_strength: int


class EndingSpec(Model):
    rank: int
    title: str
    text: str


class Balance(Model):
    economy: EconomyBalance
    loyalty: LoyaltyBalance
    stipends: StipendBalance
    observation: ObservationBalance
    matters: MattersBalance
    advice: AdviceBalance
    mood: MoodBalance
    information: InformationBalance
    heat: HeatBalance
    law: LawBalance
    rivals: RivalsBalance
    sitdown: SitDownBalance
    life: LifeBalance
    succession: SuccessionBalance
    endings: EndingsBalance


class LoyaltyBand(Model):
    id: str
    label: str
    min: Score
    lines: list[str] = Field(min_length=1)


class Observations(Model):
    loyalty_bands: list[LoyaltyBand] = Field(min_length=1)

    def band_for(self, loyalty: int) -> LoyaltyBand:
        return next(b for b in sorted(self.loyalty_bands, key=lambda b: -b.min) if loyalty >= b.min)

    def band(self, band_id: str) -> LoyaltyBand:
        return next(b for b in self.loyalty_bands if b.id == band_id)


@lru_cache
def balance() -> Balance:
    return Balance.model_validate(load_yaml("balance.yaml"))


@lru_cache
def observations() -> Observations:
    return Observations.model_validate(load_yaml("observations.yaml"))


class ContentError(ValueError):
    pass


def check_event_references(events: dict[str, EventDef]) -> None:
    """Catch broken references between events, casts and effects at load time."""
    for event in events.values():
        names = set(event.cast) | set(event.carries)
        for name, slot in event.cast.items():
            for ref in (slot.racket_of, slot.racket_not_of, slot.runs, slot.boss_of, slot.racket_in,
                        None if slot.district_of == "family" else slot.district_of):
                if ref is not None and ref not in names:
                    raise ContentError(f"{event.id}: cast slot {name} refers to unknown slot {ref}")
        names |= {r for e in event.arise_effects if e.kind == "assign_roles" for r in e.assign_roles.roles}
        all_effects = [e for o in event.options for out in o.outcomes for e in out.effects]
        if any(e.kind == "succession" for e in all_effects):
            names.add("winner")
        names |= {e.recruit.bind for e in all_effects if e.kind == "recruit"}
        for intel in event.intel:
            if intel.about is not None and intel.about not in names:
                raise ContentError(f"{event.id}: intel about unknown {intel.about}")
        for listed in event.lists.values():
            for name in listed:
                if name not in names:
                    raise ContentError(f"{event.id}: list names unknown {name}")
        effects = list(event.arise_effects) + list(event.effects)
        for option in event.options:
            for outcome in option.outcomes:
                effects.extend(outcome.effects)
        for effect in effects:
            value = getattr(effect, effect.kind)
            if effect.kind == "followup" and value.event not in events:
                raise ContentError(f"{event.id}: follow-up to unknown event {value.event}")
            who = getattr(value, "who", None)
            if who is not None and who not in names | {"crew", "don", "you", "family"}:
                raise ContentError(f"{event.id}: effect on unknown {who}")
            if effect.kind == "succession":
                names.add("winner")
            if effect.kind == "recruit":
                names.add(value.bind)
            if effect.kind == "assign_roles":
                names |= set(value.roles)
                if not set(value.pool) <= names:
                    raise ContentError(f"{event.id}: assign_roles pool has unknown slots")
            if effect.kind in ("retire", "kill") and value not in names:
                raise ContentError(f"{event.id}: retire refers to unknown {value}")
            about = getattr(value, "about", None)
            if about is not None and about not in names | {"family", "don", "you"}:
                raise ContentError(f"{event.id}: memory about unknown {about}")
            refs = (value.racket, getattr(value, "to", None)) if effect.kind in ("assign_racket", "racket_income") else ()
            for ref in refs:
                if isinstance(ref, str) and ref not in names:
                    raise ContentError(f"{event.id}: effect refers to unknown {ref}")


@lru_cache
def events() -> dict[str, EventDef]:
    """All events, keyed by id, in file-name order."""
    loaded: dict[str, EventDef] = {}
    for path in sorted((CONTENT_DIR / "events").glob("*.yaml")):
        event = EventDef.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
        if event.id != path.stem:
            raise ContentError(f"{path.name}: id {event.id!r} must match the file name")
        loaded[event.id] = event
    check_event_references(loaded)
    return loaded


@lru_cache
def sitdown_lines() -> dict[str, str]:
    """What gets said across the table, keyed by what just happened."""
    return load_yaml("sitdown.yaml")


@lru_cache
def endings() -> dict[str, EndingSpec]:
    return {k: EndingSpec.model_validate(v) for k, v in load_yaml("endings.yaml").items()}


class RecruitProfile(Model):
    traits: list[Trait]
    extra_traits: list[Trait]
    stats: dict[str, tuple[int, int]]


class Recruits(Model):
    first_names: list[str] = Field(min_length=1)
    last_names: list[str] = Field(min_length=1)
    profiles: dict[str, RecruitProfile]


@lru_cache
def recruits() -> Recruits:
    return Recruits.model_validate(load_yaml("recruits.yaml"))
