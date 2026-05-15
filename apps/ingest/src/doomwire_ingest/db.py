"""Thin DB helpers using psycopg3 directly (no ORM in ingest)."""
import json
from datetime import datetime
from typing import Any

import psycopg


def get_connection(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url)


def upsert_tweet(conn: psycopg.Connection, tweet: dict[str, Any], account_id: str) -> None:
    metrics = tweet.get("public_metrics", {})
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO tweets (tweet_id, account_id, content, tweeted_at,
                                like_count, retweet_count, reply_count, raw)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (tweet_id) DO NOTHING
            """,
            (
                tweet["id"],
                account_id,
                tweet["text"],
                datetime.fromisoformat(tweet["created_at"].replace("Z", "+00:00")),
                metrics.get("like_count", 0),
                metrics.get("retweet_count", 0),
                metrics.get("reply_count", 0),
                json.dumps(tweet),
            ),
        )
    conn.commit()


def get_account_by_handle(conn: psycopg.Connection, handle: str) -> dict | None:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id, x_user_id FROM accounts WHERE x_handle = %s AND active = true", (handle,))
        return cur.fetchone()


def update_account_user_id(conn: psycopg.Connection, account_id: str, x_user_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE accounts SET x_user_id = %s WHERE id = %s", (x_user_id, account_id))
    conn.commit()


def get_latest_tweet_id(conn: psycopg.Connection, account_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT tweet_id FROM tweets WHERE account_id = %s ORDER BY tweeted_at DESC LIMIT 1",
            (account_id,),
        )
        row = cur.fetchone()
        return row[0] if row else None
