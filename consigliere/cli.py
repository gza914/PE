"""Plain-text loop for Milestone 1. Replaced by the Textual UI in Milestone 5."""

from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path

from .engine.calendar import month_label
from .engine.commands import EndMonth, apply
from .engine.content import observations
from .engine.models import Role
from .engine.rng import GameRNG, fresh_seed
from .engine.scenario import new_game
from .engine.state import SaveError, WorldState, load_game, save_game

DEFAULT_SAVE = Path("saves/save.json")
HELP = "[n]ext month  [r]eport  [f]amily  [s]ave [path]  [l]oad [path]  [h]elp  [q]uit"
WIDTH = 60


def money(amount: int) -> str:
    return f"${amount:,}"


def ledger_row(label: str, amount: str) -> str:
    return f"  {label:<{WIDTH - len(amount) - 3}} {amount}"


def monthly_report(state: WorldState, month: int) -> list[str]:
    """The month's books and what you noticed. Reads only PlayerKnowledge."""
    knowledge = state.knowledge
    entry = knowledge.ledger_for(month)
    if entry is None:
        return [f"No report for {month_label(month)}."]
    lines = [f"=== {month_label(month)} ".ljust(WIDTH, "="), "Envelopes"]
    for line in entry.kickups:
        label = f"{line.label} [{line.note}]" if line.note else line.label
        lines.append(ledger_row(label, money(line.amount)))
    lines.append(ledger_row("Total in", money(entry.total_in)))
    lines.append("Expenses")
    for line in entry.expenses:
        amount = "UNPAID" if line.note == "unpaid" else money(line.amount)
        lines.append(ledger_row(line.label, amount))
    lines.append(ledger_row("Total out", money(entry.total_out)))
    change = entry.treasury_end - entry.treasury_start
    lines.append(f"Treasury {money(entry.treasury_start)} -> {money(entry.treasury_end)} ({change:+,})")
    noticed = knowledge.reports_for(month)
    if noticed:
        lines.append("Around the family")
        lines.extend(f"  - {report.claim}" for report in noticed)
    return lines


def family_view(state: WorldState) -> list[str]:
    """Who runs what, and how you read each man. No hidden stats."""
    family = state.player_family
    obs = observations()
    lines = [family.name, f"  Don: {state.characters[family.don_id].name}"]
    for member in state.members(family.id):
        if member.role not in (Role.UNDERBOSS, Role.CAPO):
            continue
        band = state.knowledge.impressions.get(member.id)
        reading = obs.band(band).label if band else "unknown"
        rackets = [r.name for r in state.rackets.values() if r.capo_id == member.id]
        lines.append(f"  {member.role.value.title()} {member.name} ({reading})")
        lines.extend(f"      {name}" for name in rackets)
    return lines


def status_line(state: WorldState) -> str:
    s = state.standing
    family = state.player_family
    return (
        f"{month_label(state.month)} | {family.name} | Treasury ${family.treasury:,} | "
        f"Don's Trust {s.dons_trust}  Influence {s.influence}  Exposure {s.exposure}"
    )


def run(
    state: WorldState,
    rng: GameRNG,
    read: Callable[[str], str] | None = None,
    write: Callable[[str], None] | None = None,
) -> None:
    read = read or input
    write = write or print
    write(f"You are {state.player.name}, consigliere to {state.player_family.name}.")
    write(HELP)
    while True:
        write(status_line(state))
        try:
            line = read("> ").strip()
        except EOFError:
            return
        verb, _, arg = line.partition(" ")
        verb = verb.lower()
        path = Path(arg.strip()) if arg.strip() else DEFAULT_SAVE
        if verb in ("n", "next", ""):
            apply(state, rng, EndMonth())
            for out in monthly_report(state, state.month - 1):
                write(out)
        elif verb in ("r", "report"):
            for out in monthly_report(state, state.month - 1):
                write(out)
        elif verb in ("f", "family"):
            for out in family_view(state):
                write(out)
        elif verb in ("s", "save"):
            save_game(state, rng, path)
            write(f"Saved to {path}.")
        elif verb in ("l", "load"):
            try:
                state, rng = load_game(path)
            except (OSError, SaveError) as exc:
                write(f"Could not load {path}: {exc}")
            else:
                write(f"Loaded {path}.")
        elif verb in ("h", "help", "?"):
            write(HELP)
        elif verb in ("q", "quit", "exit"):
            return
        else:
            write(f"Unknown command. {HELP}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="consigliere")
    parser.add_argument("--seed", type=int, help="seed for a new game")
    parser.add_argument("--load", type=Path, help="load a saved game")
    parser.add_argument("--scenario", default="default")
    args = parser.parse_args(argv)
    if args.load:
        state, rng = load_game(args.load)
    else:
        state, rng = new_game(args.seed if args.seed is not None else fresh_seed(), args.scenario)
    run(state, rng)
