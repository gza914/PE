# Consigliere
Text strategy game. Full design: docs/DESIGN.md. Current milestone: see docs/PROGRESS.md.

## Rules
- engine/ never imports ui/ or llm/.
- All randomness via engine/rng.py. No random module calls elsewhere.
- UI sends commands; only the engine mutates WorldState.
- Content goes in content/*.yaml, not in code.
- Every new system gets unit tests. Run pytest before finishing any task.
- Fictional names only. Follow the tone guide in DESIGN.md.

## Commands
- Run: python -m consigliere
- Test: pytest -q
- Balance: python tools/simulate.py --runs 1000
