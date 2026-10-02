# Progress

## Current milestone
1. Skeleton: **done**. Next up: Milestone 2 (Economy and characters).

## Done
- docs/DESIGN.md (from the design document PDF) and CLAUDE.md.
- Decisions: target Python 3.11 (DESIGN.md said 3.12); saves store the RNG state rather than replaying from seed.
- `consigliere/engine/`
  - `rng.py`: `GameRNG`, the only module that touches `random`; state is JSON-friendly.
  - `models.py`: Character (role, 3 to 5 traits, stats, hidden state, memory), Relationship (directed edge), Family, Racket, Investigation, Report, EventDef stub, Standing. Bounded fields are validated, including on assignment; unknown fields are rejected.
  - `state.py`: `WorldState`, `PlayerKnowledge`, JSON save/load with `SCHEMA_VERSION = 1` and a stepwise `migrate()` (`MIGRATIONS[n]` upgrades n to n + 1).
  - `turn.py` + `systems/`: `tick()` runs `SYSTEMS` in order (empty for now), then advances the month.
  - `commands.py`: `EndMonth` and `apply()`.
  - `scenario.py` + `content/scenarios/default.yaml`: one family (Ferrante), the Don, an underboss, and you (Thomas Corvo).
  - `calendar.py`: month 0 = January 1958.
- `consigliere/cli.py`: plain-text loop (`n`ext, `s`ave, `l`oad, `q`uit); `python -m consigliere --seed N` or `--load PATH`.
- Tests (31, `pytest -q`): RNG determinism and state round trip, model validation, scenario consistency, save/load round trip and migrations, tick ordering, a 24-month golden-seed determinism check, CLI loop, and architecture rules (engine never imports ui/llm/cli; no `random` outside rng.py).

## Known issues
- Nothing happens each month yet; the loop only advances the calendar.
- Content lives in `consigliere/content/` (inside the package so it ships with it), not a top-level `content/`.
- pytest is not installed in a fresh container: `pip install -e .[dev]` or `pip install pytest`.

## Next step
- Milestone 2: one family, the Don, 4 capos, 6 rackets, skimming, loyalty drift, plain-text monthly reports. Start with a plan for the economy system and the extra scenario content.
