---
description: Conventions for writing LLM prompts in apps/analyze/prompts/. Triggers when editing .md files in that directory.
---

# Prompt Authoring Conventions

All prompts live in `apps/analyze/prompts/` as `.md` files and are loaded at runtime via `llm.load_prompt()`.

## File naming
Use kebab-case: `breaking-news-detector.md`, `narrative-monitor.md`.

## Standard structure

```
# <Prompt Title>

<One sentence: what this prompt does and for which pipeline step.>

## Output Format

Respond with a JSON object:

\`\`\`json
{ ... schema ... }
\`\`\`

## Rules

Explicit, numbered rules. Include:
- Confidence threshold for acting (e.g. >= 0.6)
- Minimum evidence requirements
- What NOT to flag

## <Context sections>

Use `{placeholder}` syntax for runtime substitutions (e.g. `{factions}`).
```

## Required JSON fields for narrative-type prompts
- `detected`: boolean
- `title`: string, max 80 chars
- `summary`: string, 1-2 sentences
- `faction`: faction slug or null
- `confidence`: float 0.0–1.0
- `evidence_tweet_ids`: list of tweet IDs from the input
- `reasoning`: brief chain-of-thought (not stored, debugging only)

## Prompt caching
System prompts are cached via `cache_control: ephemeral` in `llm.complete()`. Keep the system prompt stable across calls; put variable data in the user message.

## Evaluation
For every new or modified prompt, add a fixture in `apps/analyze/fixtures/<prompt-name>/` with:
- `input.txt` — sample tweet batch
- `expected.json` — expected output shape (not exact values)

Run `/eval-prompt <name>` to compare current vs previous output on fixtures.
