"""Rackets earn, capos keep their share and skim, the family pays its bills."""

from __future__ import annotations

from ..content import Balance, EconomyBalance, balance
from ..mathutil import clamp
from ..models import Character, Family, LedgerEntry, LedgerLine, Memory, Racket
from ..rng import GameRNG
from ..state import WorldState

UNATTENDED_YIELD = 0.3  # an unassigned racket still trickles in a little


def skim_fraction(capo: Character, econ: EconomyBalance, rng: GameRNG) -> float:
    """Share of what he owes the family that a capo keeps for himself."""
    tendency = (capo.stats.greed / 100) * (1 - capo.stats.loyalty / 100)
    tendency += sum(econ.skim_trait_bonus.get(t, 0.0) for t in capo.traits)
    tendency = clamp(tendency, 0, 1)
    wobble = 1 + rng.uniform(-econ.skim_noise, econ.skim_noise)
    return clamp(econ.max_skim * tendency * wobble, 0, econ.max_skim)


def collect(racket: Racket, capo: Character | None, econ: EconomyBalance, rng: GameRNG) -> tuple[int, int]:
    """Returns (kicked up to the family, skimmed by the capo)."""
    swing = 1 + rng.uniform(-econ.income_variance, econ.income_variance)
    if capo is None or not capo.alive:
        return round(racket.income * swing * UNATTENDED_YIELD), 0
    competence = econ.competence_floor + 2 * (1 - econ.competence_floor) * capo.stats.competence / 100
    gross = racket.income * swing * competence
    owed = round(gross * (1 - econ.capo_share))
    skim = round(owed * skim_fraction(capo, econ, rng))
    return owed - skim, skim


def miss_stipend(state: WorldState, family: Family, bal: Balance) -> None:
    for member in state.members(family.id):
        if member.id != family.don_id:
            member.memory.append(Memory(
                event_id="stipend_missed",
                about_id=family.id,
                month=state.month,
                weight=bal.stipends.missed_memory_weight,
                decay_rate=bal.stipends.missed_decay_rate,
            ))


def run_family(state: WorldState, family: Family, rng: GameRNG, bal: Balance) -> LedgerEntry:
    entry = LedgerEntry(month=state.month, treasury_start=family.treasury, treasury_end=family.treasury)
    if family.id == state.player.family_id and state.unbooked:
        entry.other = state.unbooked
        entry.treasury_start -= sum(line.amount for line in state.unbooked)
        state.unbooked = []
    for racket in state.rackets.values():
        if racket.family_id != family.id:
            continue
        capo = state.characters.get(racket.capo_id) if racket.capo_id else None
        kickup, skim = collect(racket, capo, bal.economy, rng)
        if capo is not None and capo.alive:
            capo.hidden.stash += skim
            entry.kickups.append(LedgerLine(label=f"{racket.name} ({capo.name})", amount=kickup))
        else:
            entry.kickups.append(LedgerLine(label=racket.name, amount=kickup, note="unattended"))
        family.treasury += kickup

    for expense in family.expenses:
        if family.treasury >= expense.amount:
            family.treasury -= expense.amount
            entry.expenses.append(LedgerLine(label=expense.label, amount=expense.amount))
        else:
            entry.expenses.append(LedgerLine(label=expense.label, amount=expense.amount, note="unpaid"))
            if expense.stipend:
                miss_stipend(state, family, bal)

    entry.treasury_end = family.treasury
    return entry


def run(state: WorldState, rng: GameRNG, bal: Balance | None = None) -> None:
    bal = bal or balance()
    player_family_id = state.player.family_id
    for family in state.families.values():
        entry = run_family(state, family, rng, bal)
        if family.id == player_family_id:
            state.knowledge.ledger.append(entry)
