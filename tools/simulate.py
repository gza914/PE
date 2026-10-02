"""Play many headless games with bot strategies and report on balance.

Usage:
  python tools/simulate.py --runs 1000
  python tools/simulate.py --runs 200 --strategies cautious,aggressive --jobs 4 --json out.json

Per strategy it reports how long runs last, how they end, how often they "win" (retire or reach
1972 with the family intact), the treasury year by year, and how often wars break out. Across all
strategies it lists events that never fired. Balance bugs, per docs/DESIGN.md: a strategy that wins
more than 70% of the time, or an event that never fires. With --strict the exit code is 1 if any.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from consigliere.engine.commands import CommandError, EndMonth, apply  # noqa: E402
from consigliere.engine.content import endings, events  # noqa: E402
from consigliere.engine.scenario import new_game  # noqa: E402
from tools.bots import STRATEGIES, sitdown_command  # noqa: E402

WIN_RANK = 2  # retired with the family intact, or the end of an era with the family intact
WIN_LIMIT = 0.70
FIRST_YEAR = 1958
LAST_MONTH = 179


def play(strategy: str, seed: int, months: int = LAST_MONTH + 1) -> dict:
    """One game, start to finish (or to the month cap). Returns what the report needs."""
    state, rng = new_game(seed)
    bot = STRATEGIES[strategy](seed)
    fired: set[str] = set(state.event_log)
    war_months = wars = 0
    at_war = set()
    for _ in range(months):
        if state.ending is not None:
            break
        for _ in range(8):
            if state.sitdown is None:
                break
            apply(state, rng, sitdown_command(bot, state))
        for command in bot.act(state):
            try:
                apply(state, rng, command)
            except CommandError:
                pass  # a verification that is no longer possible, say
        apply(state, rng, EndMonth())
        fired.update(state.event_log)
        now = {k for k, r in state.rivalries.items() if r.stage == 5}
        wars += len(now - at_war)
        war_months += 1 if now else 0
        at_war = now
    year_end = {e.month // 12: e.treasury_end for e in state.knowledge.ledger if e.month % 12 == 11}
    ending = state.ending
    return {
        "strategy": strategy,
        "seed": seed,
        "months": ending.month + 1 if ending else state.month,
        "ending": ending.id if ending else "unfinished",
        "rank": ending.rank if ending else None,
        "treasury_by_year": year_end,
        "wars": wars,
        "war_months": war_months,
        "fired": sorted(fired),
        "final_trust": state.standing.dons_trust,
        "rat_found": "rat_known" in state.flags,
    }


def _play(args: tuple[str, int, int]) -> dict:
    return play(*args)


def summarize(results: list[dict]) -> dict:
    by_strategy: dict[str, list[dict]] = {}
    for r in results:
        by_strategy.setdefault(r["strategy"], []).append(r)
    report = {"strategies": {}, "never_fired": [], "bugs": []}
    for name, runs in by_strategy.items():
        n = len(runs)
        finished = [r for r in runs if r["rank"] is not None]
        wins = sum(1 for r in finished if r["rank"] <= WIN_RANK)
        years: dict[int, list[int]] = {}
        for r in runs:
            for year, treasury in r["treasury_by_year"].items():
                years.setdefault(int(year), []).append(treasury)
        summary = {
            "runs": n,
            "avg_months": round(sum(r["months"] for r in runs) / n, 1),
            "win_rate": round(wins / n, 3),
            "avg_rank": round(sum(r["rank"] for r in finished) / len(finished), 2) if finished else None,
            "endings": dict(Counter(r["ending"] for r in runs).most_common()),
            "treasury_by_year": {FIRST_YEAR + y: round(sum(v) / len(v)) for y, v in sorted(years.items())},
            "war_rate": round(sum(1 for r in runs if r["wars"]) / n, 3),
            "avg_war_months": round(sum(r["war_months"] for r in runs) / n, 1),
            "rat_found_rate": round(sum(1 for r in runs if r["rat_found"]) / n, 3),
            "avg_final_trust": round(sum(r["final_trust"] for r in runs) / n, 1),
        }
        report["strategies"][name] = summary
        if summary["win_rate"] > WIN_LIMIT:
            report["bugs"].append(f"{name} wins {summary['win_rate']:.0%} of runs (limit {WIN_LIMIT:.0%})")
    fired = set().union(*(set(r["fired"]) for r in results)) if results else set()
    report["never_fired"] = sorted(set(events()) - fired)
    unexpected = [e for e in report["never_fired"] if not events()[e].rare]
    if unexpected:
        report["bugs"].append(f"{len(unexpected)} event(s) never fired: {', '.join(unexpected)}")
    return report


def render(report: dict, runs: int, seconds: float) -> str:
    names = list(report["strategies"])
    lines = [f"# Balance report: {runs} runs per strategy ({seconds:.0f}s)", ""]
    lines.append("| Strategy | Win rate | Avg rank | Avg length | Wars | War months | Rat found | Final trust |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for name in names:
        s = report["strategies"][name]
        flag = " ⚠" if s["win_rate"] > WIN_LIMIT else ""
        lines.append(f"| {name} | {s['win_rate']:.0%}{flag} | {s['avg_rank']} | {s['avg_months']:.0f} mo "
                     f"| {s['war_rate']:.0%} | {s['avg_war_months']} | {s['rat_found_rate']:.0%} | {s['avg_final_trust']} |")
    lines += ["", "## How runs end", ""]
    titles = {k: v.title for k, v in endings().items()} | {"unfinished": "Unfinished (month cap)"}
    ending_ids = sorted({e for s in report["strategies"].values() for e in s["endings"]},
                        key=lambda e: endings()[e].rank if e in endings() else 99)
    lines.append("| Ending | " + " | ".join(names) + " |")
    lines.append("|---|" + "---|" * len(names))
    for e in ending_ids:
        cells = [f"{report['strategies'][n]['endings'].get(e, 0) / report['strategies'][n]['runs']:.0%}" for n in names]
        lines.append(f"| {titles.get(e, e)} | " + " | ".join(cells) + " |")
    lines += ["", "## Average treasury at year end ($ thousands, runs still going)", ""]
    years = sorted({y for s in report["strategies"].values() for y in s["treasury_by_year"]})
    lines.append("| Year | " + " | ".join(names) + " |")
    lines.append("|---|" + "---|" * len(names))
    for y in years:
        cells = []
        for n in names:
            v = report["strategies"][n]["treasury_by_year"].get(y)
            cells.append("" if v is None else f"{v / 1000:.0f}")
        lines.append(f"| {y} | " + " | ".join(cells) + " |")
    rare = [e for e in report["never_fired"] if events()[e].rare]
    if rare:
        lines += ["", f"Rare fallbacks that never fired (expected): {', '.join(rare)}"]
    lines += ["", "## Balance bugs", ""]
    lines += [f"- {b}" for b in report["bugs"]] or ["- None."]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runs", type=int, default=200, help="games per strategy (default 200)")
    parser.add_argument("--strategies", default=",".join(STRATEGIES), help="comma-separated: " + ", ".join(STRATEGIES))
    parser.add_argument("--seed", type=int, default=0, help="first seed; runs use seed .. seed+runs-1")
    parser.add_argument("--months", type=int, default=LAST_MONTH + 1, help="cap on months per game")
    parser.add_argument("--jobs", type=int, default=0, help="worker processes (default: all cores; 1 = no pool)")
    parser.add_argument("--json", type=Path, help="also write the full report as JSON")
    parser.add_argument("--report", type=Path, help="also write the Markdown report to a file")
    parser.add_argument("--strict", action="store_true", help="exit with status 1 if any balance bug is found")
    args = parser.parse_args(argv)

    names = [s.strip() for s in args.strategies.split(",") if s.strip()]
    unknown = [n for n in names if n not in STRATEGIES]
    if unknown:
        parser.error(f"unknown strategies: {', '.join(unknown)}")
    tasks = [(name, seed, args.months) for name in names for seed in range(args.seed, args.seed + args.runs)]
    started = time.time()
    if args.jobs == 1:
        results = [_play(t) for t in tasks]
    else:
        with ProcessPoolExecutor(max_workers=args.jobs or None) as pool:
            results = list(pool.map(_play, tasks, chunksize=max(1, len(tasks) // 64)))
    report = summarize(results)
    text = render(report, args.runs, time.time() - started)
    print(text)
    if args.report:
        args.report.write_text(text + "\n", encoding="utf-8")
    if args.json:
        args.json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 1 if args.strict and report["bugs"] else 0


if __name__ == "__main__":
    sys.exit(main())
