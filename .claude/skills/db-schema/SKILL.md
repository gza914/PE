---
description: Drizzle ORM conventions and migration patterns. Triggers on changes to packages/db/src/schema/ or packages/db/migrations/.
---

# DB Schema Skill

## Stack
- Drizzle ORM + drizzle-kit for migrations
- Postgres (Supabase in prod, docker-compose locally)
- Client: `packages/db/src/client.ts` — import `db` from there

## Schema files
Each table gets its own file in `packages/db/src/schema/`:
- `factions.ts`, `accounts.ts`, `tweets.ts`, `narratives.ts`
- Export everything from `src/schema/index.ts`

## Canonical table relationships
```
factions ← accounts ← tweets
factions ← narratives
```

## Migration workflow
```bash
# 1. Edit schema file
# 2. Generate migration SQL
pnpm db:generate

# 3. Review the generated SQL in packages/db/migrations/
# 4. Apply
pnpm db:migrate
```

Never edit the DB directly. Never hand-write migration SQL — let drizzle-kit generate it.

## Naming conventions
- Table names: snake_case, plural (`tweets`, `narrative_snapshots`)
- Column names: snake_case
- Drizzle field names: camelCase (mapped to snake_case via the column name string)
- All tables get `created_at` with `defaultNow()`
- All mutable tables get `updated_at` (must be updated by app logic or trigger)
- Primary keys: UUID via `uuid().primaryKey().defaultRandom()`

## Index rules
- Add an index for every foreign key column
- Add an index for any column used in `WHERE` clauses on large tables
- Use `pgTable` not `sqliteTable` — we're on Postgres

## Breaking changes
Before adding a NOT NULL column to an existing table, check row count. If > 10k rows, add nullable first, backfill, then add the constraint in a second migration.
