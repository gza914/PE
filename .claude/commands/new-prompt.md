---
description: Create a new LLM prompt file with standard frontmatter and an eval fixture stub.
---

Create a new prompt in apps/analyze/prompts/.

Arguments: $ARGUMENTS (prompt name in kebab-case)

Steps:
1. Create `apps/analyze/prompts/<name>.md` using the standard structure from the prompt-authoring skill
2. Create `apps/analyze/fixtures/<name>/input.txt` with a placeholder comment
3. Create `apps/analyze/fixtures/<name>/expected.json` with the standard narrative output schema shape
4. Open the prompt file for editing
5. Remind the user to fill in the eval fixture with a real tweet batch before shipping
