"""Memories fade; loyalty drifts toward what a man's situation makes it; cohesion follows."""

from __future__ import annotations

from ..content import Balance, LoyaltyBalance, balance
from ..mathutil import clamp
from ..models import Character, Family
from ..rng import GameRNG
from ..state import WorldState


def decay_memories(character: Character, forget_below: float) -> None:
    for memory in character.memory:
        memory.weight *= 1 - memory.decay_rate
    character.memory = [m for m in character.memory if abs(m.weight) >= forget_below]


def loyalty_target(character: Character, family: Family, don: Character, lb: LoyaltyBalance) -> float:
    target = lb.base
    target += (don.stats.respect - 50) * lb.don_respect_weight
    target += (family.cohesion - 50) * lb.cohesion_weight
    target += sum(lb.trait_targets.get(t, 0.0) for t in character.traits)
    remembered = sum(m.weight for m in character.memory if m.about_id in (family.id, don.id))
    target += clamp(remembered, -lb.memory_cap, lb.memory_cap)
    return clamp(target)


def drift_family(state: WorldState, family: Family, rng: GameRNG, lb: LoyaltyBalance) -> None:
    don = state.characters[family.don_id]
    crew = [m for m in state.members(family.id) if m.alive and m.id not in (family.don_id, state.player_id)]
    for member in crew:
        target = loyalty_target(member, family, don, lb)
        delta = (target - member.stats.loyalty) * lb.drift_rate + rng.uniform(-lb.noise, lb.noise)
        member.stats.loyalty = int(clamp(member.stats.loyalty + rng.round_stochastic(delta)))
    if crew:
        mean = sum(m.stats.loyalty for m in crew) / len(crew)
        shift = (mean - family.cohesion) * lb.cohesion_drift_rate
        family.cohesion = int(clamp(family.cohesion + rng.round_stochastic(shift)))


def run(state: WorldState, rng: GameRNG, bal: Balance | None = None) -> None:
    bal = bal or balance()
    for character in state.characters.values():
        decay_memories(character, bal.loyalty.forget_below)
    for family in state.families.values():
        drift_family(state, family, rng, bal.loyalty)
