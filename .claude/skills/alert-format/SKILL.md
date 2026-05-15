---
description: Slack alert format for Doomwire narrative notifications. Triggers on alert-related code.
---

# Alert Format Skill

Alerts are sent to Slack via Block Kit. Every narrative alert must include:

## Required fields
- **Title** — narrative title, linked to the dashboard URL
- **Faction badge** — faction name with emoji indicator
- **Confidence** — displayed as a percentage and a visual bar (🟩🟩🟩🟨⬜ scale)
- **Summary** — 1-2 sentence narrative description
- **Evidence tweets** — 2-3 tweet links, formatted as `@handle: "quote excerpt..."`
- **Timestamp** — when the narrative was detected

## Block Kit structure
```json
{
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "🚨 <title>" } },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Faction:* <faction>" },
        { "type": "mrkdwn", "text": "*Confidence:* <bar> <pct>%" }
      ]
    },
    { "type": "section", "text": { "type": "mrkdwn", "text": "<summary>" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "*Evidence:*\n<tweets>" } },
    { "type": "divider" }
  ]
}
```

## Confidence bar
Map confidence 0.0–1.0 to filled/empty blocks (5 total):
- 0.0–0.2 → ⬜⬜⬜⬜⬜
- 0.2–0.4 → 🟨⬜⬜⬜⬜
- 0.4–0.6 → 🟩🟨⬜⬜⬜
- 0.6–0.8 → 🟩🟩🟩🟨⬜
- 0.8–1.0 → 🟩🟩🟩🟩🟩

## Never alert on confidence < 0.6
The pipeline enforces this, but the alert sender should double-check and drop low-confidence narratives.
