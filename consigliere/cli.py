"""Plain-text loop. The main interface is the web page (web/); this stays for quick headless play."""

from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path

from .engine.calendar import month_label
from .engine.commands import CommandError, EndMonth, Recommend, apply
from .engine.content import observations
from .engine.models import Role
from .engine.rng import GameRNG, fresh_seed
from .engine.scenario import new_game
from .engine.state import SaveError, WorldState, load_game, save_game

DEFAULT_SAVE = Path("saves/save.json")
HELP = "[d]esk  [a]dvise N choice  [n]ext month  [r]eport  [f]amily  [s]ave [path]  [l]oad [path]  [h]elp  [q]uit"
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
    if entry.other:
        lines.append("Other")
        lines.extend(ledger_row(line.label, f"{line.amount:+,}") for line in entry.other)
    change = entry.treasury_end - entry.treasury_start
    lines.append(f"Treasury {money(entry.treasury_start)} -> {money(entry.treasury_end)} ({change:+,})")
    decided = [d for d in knowledge.decisions if d.month == month]
    if decided:
        lines.append("The Don's decisions")
        for d in decided:
            advice = f"you advised: {d.recommended}" if d.recommended else "you kept quiet"
            lines.append(f"  {d.title}: {d.chosen} ({advice}; trust {d.trust_delta:+d})")
            lines.append(f"    {d.text}")
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


def desk_view(state: WorldState) -> list[str]:
    """News that arrived this month and the matters waiting for your advice."""
    lines = []
    for item in (n for n in state.knowledge.news if n.month == state.month):
        lines.append(f"NEWS: {item.title}")
        lines.append(f"  {item.text}")
    if not state.matters:
        lines.append("Nothing on your desk this month.")
    for i, matter in enumerate(state.matters, 1):
        lines.append(f"[{i}] {matter.title}")
        lines.extend(f"    {para}" for para in matter.text.split("\n") if para)
        for j, option in enumerate(matter.options, 1):
            mark = "*" if matter.recommendation == option.id else " "
            lines.append(f"   {mark}{j}. {option.label}")
        if matter.can_wait:
            lines.append(f"   {'*' if matter.recommendation == 'wait' else ' '}w. Let it wait")
        lines.append(f"   {'*' if matter.recommendation is None else ' '}s. Say nothing")
    return lines


def advise(state: WorldState, rng: GameRNG, arg: str) -> str:
    """Parse "N choice": choice is an option number, w (wait) or s (say nothing)."""
    parts = arg.split()
    if len(parts) != 2 or not parts[0].isdigit() or not 1 <= int(parts[0]) <= len(state.matters):
        return "Usage: a <matter number> <option number | w | s>"
    matter = state.matters[int(parts[0]) - 1]
    pick = parts[1].lower()
    if pick == "s":
        choice = None
    elif pick == "w":
        choice = "wait"
    elif pick.isdigit() and 1 <= int(pick) <= len(matter.options):
        choice = matter.options[int(pick) - 1].id
    else:
        return "Usage: a <matter number> <option number | w | s>"
    try:
        apply(state, rng, Recommend(matter_id=matter.id, choice=choice))
    except CommandError as exc:
        return str(exc)
    return f"Noted for {matter.title}."


def status_line(state: WorldState) -> str:
    s = state.standing
    family = state.player_family
    return (
        f"{month_label(state.month)} | {family.name} | Treasury ${family.treasury:,} | "
        f"Don's Trust {s.dons_trust}  Influence {s.influence}  Exposure {s.exposure}  Desk {len(state.matters)}"
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
            for out in monthly_report(state, state.month - 1) + desk_view(state):
                write(out)
        elif verb in ("d", "desk"):
            for out in desk_view(state):
                write(out)
        elif verb in ("a", "advise"):
            write(advise(state, rng, arg))
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
