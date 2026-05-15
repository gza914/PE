import os
from dotenv import load_dotenv

load_dotenv()


def require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


DATABASE_URL = require("DATABASE_URL")
X_BEARER_TOKEN = require("X_BEARER_TOKEN")
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))
MAX_RESULTS_PER_USER = int(os.getenv("MAX_RESULTS_PER_USER", "10"))
