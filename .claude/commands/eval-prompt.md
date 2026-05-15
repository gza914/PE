---
description: Run the prompt evaluator on a named prompt against its fixture set.
---

Evaluate a prompt against its fixtures.

Arguments: $ARGUMENTS (prompt name)

Steps:
1. Read `apps/analyze/prompts/<name>.md` (current version)
2. Read all files in `apps/analyze/fixtures/<name>/`
3. Run the prompt against `input.txt` using the LLM (via `apps/analyze/src/doomwire_analyze/llm.py`)
4. Compare the output structure to `expected.json` — flag any missing fields or type mismatches
5. Report: diff of output vs expected, confidence score, and any structural issues
