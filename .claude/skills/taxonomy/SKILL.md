---
description: Schema and rules for taxonomy/factions.yaml and taxonomy/accounts.yaml. Triggers on edits to taxonomy/*.yaml files.
---

# Taxonomy Skill

The taxonomy is the moat. It lives in version control and syncs to the DB on deploy.

## File locations
- `taxonomy/factions.yaml` — faction definitions
- `taxonomy/accounts.yaml` — account→faction mappings

## factions.yaml schema

```yaml
- slug: kebab-case-unique     # required, unique, immutable once in DB
  name: Human Readable Name   # required
  description: One sentence.  # optional but encouraged
  ideology: short label       # optional
```

**Never rename a slug** — it's a foreign key in the DB. Add a new one and deprecate the old instead.

## accounts.yaml schema

```yaml
- handle: TwitterHandle       # required, unique, no @ prefix
  faction: faction-slug       # required, must match a slug in factions.yaml
  display_name: Full Name     # optional
  notes: context string       # optional, for curator notes
```

## Validation
Run `pnpm taxonomy:validate` after any edit. This is also enforced by a PostToolUse hook on edits to `taxonomy/*.yaml`.

Validation checks:
- All required fields present
- No duplicate slugs or handles
- Every account's `faction` references a real faction slug

## Adding a new account
1. Add to `accounts.yaml`, keeping the list sorted by faction slug then handle
2. Run `pnpm taxonomy:validate`
3. Open a PR — taxonomy changes require review

## Adding a new faction
1. Add to `factions.yaml`
2. Assign existing accounts to it in `accounts.yaml` if applicable
3. Run `pnpm taxonomy:validate`
4. Open a PR

## Sync to DB
`pnpm taxonomy:sync` upserts factions then accounts. Safe to run repeatedly. Runs automatically on deploy.
