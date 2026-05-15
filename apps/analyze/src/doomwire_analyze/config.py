import os
from dotenv import load_dotenv

load_dotenv()


def require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


DATABASE_URL = require("DATABASE_URL")
ANTHROPIC_API_KEY = require("ANTHROPIC_API_KEY")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
ANALYSIS_WINDOW_HOURS = int(os.getenv("ANALYSIS_WINDOW_HOURS", "6"))
ANALYSIS_BATCH_SIZE = int(os.getenv("ANALYSIS_BATCH_SIZE", "50"))
