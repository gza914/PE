"""Plain-text loop for Milestone 1. Replaced by the Textual UI in Milestone 5."""

from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path

from .engine.calendar import month_label
from .engine.commands import EndMonth, apply
from .engine.rng import GameRNG, fresh_seed
from .engine.scenario import new_game
from .engine.state import SaveError, WorldState, load_game, save_game

DEFAULT_SAVE = Path("saves/save.json")
HELP = "[n]ext month  [s]ave [path]  [l]oad [path]  [h]elp  [q]uit"


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
