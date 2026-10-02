"""You notice when someone's loyalty shifts, unless he hides it well."""

from __future__ import annotations

from ..content import Balance, Observations, balance, observations
from ..models import Character, Report
from ..rng import GameRNG
from ..state import WorldState


def watched(state: WorldState) -> list[Character]:
    family = state.player_family
    return [m for m in state.members(family.id) if m.alive and m.id not in (family.don_id, state.player_id)]


def initial_impressions(state: WorldState, obs: Observations | None = None) -> None:
    """At the start you know your own people."""
    obs = obs or observations()
    for member in watched(state):
        state.knowledge.impressions[member.id] = obs.band_for(member.stats.loyalty).id


def run(state: WorldState, rng: GameRNG, bal: Balance | None = None, obs: Observations | None = None) -> None:
    bal = bal or balance()
    obs = obs or observations()
    ob = bal.observation
    for member in watched(state):
        band = obs.band_for(member.stats.loyalty)
        if state.knowledge.impressions.get(member.id) == band.id:
            continue
        notice = ob.base_notice + ob.indiscretion_weight * (100 - member.stats.discretion) / 100
        if not rng.chance(notice):
            continue
        state.knowledge.impressions[member.id] = band.id
        state.knowledge.reports.append(Report(
            id=f"obs-{state.month}-{member.id}",
            subject_id=member.id,
            claim=rng.choice(band.lines).format(name=member.name),
            source_id=state.player_id,
            month=state.month,
            confidence=ob.confidence,
        ))
