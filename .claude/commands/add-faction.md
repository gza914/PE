---
description: Scaffold a new faction in taxonomy/factions.yaml and open it for editing.
---

Add a new faction to the taxonomy.

Arguments: $ARGUMENTS (faction name or slug)

Steps:
1. Read `taxonomy/factions.yaml` to check for existing slugs
2. Derive a kebab-case slug from the argument if not already slugified
3. Append the new faction entry with `slug`, `name`, and placeholder `description`/`ideology` fields
4. Run `pnpm taxonomy:validate` to confirm no errors
5. Report the new slug and remind the user to fill in description/ideology and open a PR
