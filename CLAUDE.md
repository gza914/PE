# Consigliere
Text strategy game. Full design: docs/DESIGN.md. Current milestone: see docs/PROGRESS.md.

## Rules
- engine/ never imports web/, cli, or llm/. The web page (web/) is the main interface.
- All randomness via engine/rng.py. No random module calls elsewhere.
- UI sends commands; only the engine mutates WorldState.
- Content goes in content/*.yaml, not in code.
- Every new system gets unit tests. Run pytest before finishing any task.
- Fictional names only. Follow the tone guide in DESIGN.md.
- web/engine.js mirrors the Python tick step for step (same RNG, same float order). Any change to
  engine/systems must be mirrored there; tests/test_web_parity.py fails otherwise.

## Commands
- Run (text): python -m consigliere
- Test: pytest -q
- Balance: python tools/simulate.py --runs 1000
- Web build: python tools/build_web.py  (writes web/dist/consigliere.html, one self-contained page)
