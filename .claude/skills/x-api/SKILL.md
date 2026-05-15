---
description: X API v2 usage patterns for apps/ingest. Triggers on edits to apps/ingest/.
---

# X API Skill

## Auth
Bearer token only (App-only auth). Set `X_BEARER_TOKEN` in `.env`.
Header: `Authorization: Bearer <token>`.

## Endpoints used
- `GET /2/users/by/username/:handle` — resolve handle → user ID (cache this, IDs don't change)
- `GET /2/users/:id/tweets` — recent tweets for a user

## Tweet fields to request
Always include: `tweet.fields=created_at,public_metrics,text`
These map directly to the `tweets` table columns.

## Rate limits (free/basic tier)
- User timeline: 15 req/15 min per app
- User lookup: 25 req/24 hours per app
- Respect `x-rate-limit-remaining` and `x-rate-limit-reset` headers

## Retry strategy
Use `tenacity` with exponential backoff (2s min, 30s max, 3 attempts). See `x_client.py`.
On 429: back off using the `x-rate-limit-reset` header value, not a fixed delay.

## Never call X from web
The web app (`apps/web`) must never call the X API. Only `apps/ingest` polls.
Cached data in Postgres is the source of truth for the dashboard.

## `since_id` pagination
Track the latest ingested `tweet_id` per account and pass as `since_id` on each poll.
This avoids re-ingesting tweets and is cheaper on rate limits.
