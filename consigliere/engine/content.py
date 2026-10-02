"""Loads tuning numbers and flavor text from content/*.yaml."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import Field

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


class Balance(Model):
    economy: EconomyBalance
    loyalty: LoyaltyBalance
    stipends: StipendBalance
    observation: ObservationBalance


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
