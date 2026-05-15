"""X API v2 client — thin wrapper, no logic."""
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

BASE_URL = "https://api.twitter.com/2"
TWEET_FIELDS = "created_at,public_metrics,text"
EXPANSIONS = "author_id"


class XClient:
    def __init__(self, bearer_token: str) -> None:
        self._http = httpx.Client(
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {bearer_token}"},
            timeout=30.0,
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
    def get_user_id(self, handle: str) -> str:
        r = self._http.get(f"/users/by/username/{handle}")
        r.raise_for_status()
        return r.json()["data"]["id"]

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
    def get_recent_tweets(
        self,
        user_id: str,
        max_results: int = 10,
        since_id: str | None = None,
    ) -> list[dict]:
        params: dict = {
            "tweet.fields": TWEET_FIELDS,
            "max_results": max_results,
        }
        if since_id:
            params["since_id"] = since_id
        r = self._http.get(f"/users/{user_id}/tweets", params=params)
        r.raise_for_status()
        return r.json().get("data", [])

    def close(self) -> None:
        self._http.close()
