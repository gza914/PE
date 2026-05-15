"""Main poll loop — no X API calls from anywhere else."""
import logging
import time

from . import config
from .db import (
    get_account_by_handle,
    get_connection,
    get_latest_tweet_id,
    update_account_user_id,
    upsert_tweet,
)
from .x_client import XClient

log = logging.getLogger(__name__)


def poll_once(client: XClient) -> None:
    conn = get_connection(config.DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT x_handle FROM accounts WHERE active = true ORDER BY x_handle")
            handles = [row[0] for row in cur.fetchall()]

        log.info("Polling %d accounts", len(handles))
        for handle in handles:
            try:
                account = get_account_by_handle(conn, handle)
                if not account:
                    continue

                user_id = account["x_user_id"]
                if not user_id:
                    user_id = client.get_user_id(handle)
                    update_account_user_id(conn, account["id"], user_id)

                since_id = get_latest_tweet_id(conn, account["id"])
                tweets = client.get_recent_tweets(user_id, config.MAX_RESULTS_PER_USER, since_id)

                for tweet in tweets:
                    upsert_tweet(conn, tweet, account["id"])

                if tweets:
                    log.info("@%s: +%d tweets", handle, len(tweets))
            except Exception:
                log.exception("Failed polling @%s", handle)
    finally:
        conn.close()


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    client = XClient(config.X_BEARER_TOKEN)
    log.info("Ingest poller starting, interval=%ds", config.POLL_INTERVAL_SECONDS)
    try:
        while True:
            poll_once(client)
            time.sleep(config.POLL_INTERVAL_SECONDS)
    finally:
        client.close()
