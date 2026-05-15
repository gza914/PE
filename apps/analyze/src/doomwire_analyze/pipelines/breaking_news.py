"""Breaking news detector pipeline."""
import json
import logging
from datetime import datetime, timedelta, timezone

import psycopg
import psycopg.rows

from .. import config
from ..llm import complete, load_prompt

log = logging.getLogger(__name__)


def _build_faction_reference(conn: psycopg.Connection) -> str:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT slug, name, description FROM factions ORDER BY slug")
        rows = cur.fetchall()
    return "\n".join(f"- {r['slug']}: {r['name']} — {r['description'] or ''}" for r in rows)


def _fetch_recent_tweets(conn: psycopg.Connection) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(hours=config.ANALYSIS_WINDOW_HOURS)
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT t.tweet_id, t.content, t.tweeted_at, a.x_handle, f.slug as faction_slug
            FROM tweets t
            JOIN accounts a ON a.id = t.account_id
            LEFT JOIN factions f ON f.id = a.faction_id
            WHERE t.tweeted_at >= %s
            ORDER BY t.tweeted_at DESC
            LIMIT %s
            """,
            (since, config.ANALYSIS_BATCH_SIZE),
        )
        return cur.fetchall()


def _save_narrative(conn: psycopg.Connection, result: dict, faction_id: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO narratives (slug, title, summary, faction_id, confidence, evidence_tweet_ids)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                f"breaking-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}",
                result["title"],
                result["summary"],
                faction_id,
                result["confidence"],
                json.dumps(result.get("evidence_tweet_ids", [])),
            ),
        )
    conn.commit()


def run(conn: psycopg.Connection) -> None:
    tweets = _fetch_recent_tweets(conn)
    if not tweets:
        log.info("No recent tweets to analyze")
        return

    faction_ref = _build_faction_reference(conn)
    system_prompt = load_prompt("breaking-news-detector").replace("{factions}", faction_ref)

    tweet_block = "\n".join(
        f"[{t['tweet_id']}] @{t['x_handle']} ({t['faction_slug'] or 'unknown'}): {t['content']}"
        for t in tweets
    )

    raw = complete(system_prompt, tweet_block)

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        log.error("LLM returned non-JSON: %s", raw[:200])
        return

    if not result.get("detected"):
        log.info("No breaking narrative detected (confidence=%.2f)", result.get("confidence", 0))
        return

    faction_id: str | None = None
    if result.get("faction"):
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM factions WHERE slug = %s", (result["faction"],))
            row = cur.fetchone()
            if row:
                faction_id = row[0]

    _save_narrative(conn, result, faction_id)
    log.info("Narrative saved: %s (confidence=%.2f)", result["title"], result["confidence"])
