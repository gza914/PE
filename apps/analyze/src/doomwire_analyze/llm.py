"""LLM client wrapper with prompt loading and caching."""
from pathlib import Path
import anthropic
from . import config

_client: anthropic.Anthropic | None = None
PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


def load_prompt(name: str) -> str:
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt not found: {path}")
    return path.read_text()


def complete(system: str, user: str, max_tokens: int = 2048) -> str:
    client = get_client()
    response = client.messages.create(
        model=config.CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user}],
    )
    return response.content[0].text  # type: ignore[union-attr]
