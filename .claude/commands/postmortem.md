---
description: Draft a post-mortem for a narrative event using its DB snapshot history.
---

Draft a post-mortem for a narrative event.

Arguments: $ARGUMENTS (narrative slug or ID)

Steps:
1. Query the DB for the narrative row matching the slug/ID
2. Fetch all `narrative_snapshots` for that narrative, ordered by `snapshot_at`
3. Fetch the evidence tweets (from `evidence_tweet_ids` on the latest snapshot)
4. Draft a post-mortem in this format:
   - **Narrative**: title
   - **Faction**: faction name
   - **Timeline**: snapshot-by-snapshot confidence and volume chart (text table)
   - **Peak**: highest confidence point and what was happening
   - **Evidence**: 3-5 key tweets with handles and timestamps
   - **Resolution**: how/when the narrative faded (or note if still active)
5. Output the draft as markdown
