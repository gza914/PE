# Doomwire

Real-time narrative intelligence for X. Curated factions + LLM analysis + alerts.

## Architecture
- `apps/ingest` polls X API, writes to Postgres
- `apps/analyze` runs LLM pipelines on the tweet stream
- `apps/web` is the Next.js dashboard
- `taxonomy/*.yaml` is the source of truth for factions — sync to DB on deploy

## Stack
- Postgres (Supabase), Drizzle ORM, Next.js 15, Python 3.12, uv, FastAPI
- Anthropic SDK for LLM calls — never hardcode models, read from env
- Inngest for scheduled jobs

## Conventions
- All LLM prompts live in `apps/analyze/prompts/` as `.md` files, loaded at runtime
- Database changes: write a Drizzle migration, never edit the DB directly
- Faction taxonomy edits go through PR review — never bypass

## Don'ts
- Never commit `.env` or anything in `secrets/`
- Never call the X API from the web app — only from `apps/ingest`
- Never call LLMs from the web app at request time — use cached results from Postgres

## Routing
- Detailed schema rules → `.claude/skills/db-schema/`
- Prompt patterns → `.claude/skills/prompt-authoring/`
- Faction taxonomy rules → `.claude/skills/taxonomy/`
- X API details → `.claude/skills/x-api/`
- Alert formatting → `.claude/skills/alert-format/`
