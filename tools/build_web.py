"""Build the single-file web version: web/dist/consigliere.html.

Content (balance, observations) and each scenario's starting WorldState come from the
Python engine, validated, so the web build never re-implements content loading.
The monthly tick runs in web/engine.js, kept in step with Python by tests/test_web_parity.py.

Usage: python tools/build_web.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from consigliere.engine.content import CONTENT_DIR, balance, observations  # noqa: E402
from consigliere.engine.scenario import load_scenario  # noqa: E402

WEB = ROOT / "web"
OUT = WEB / "dist" / "consigliere.html"


def content_bundle() -> dict:
    scenarios = sorted(p.stem for p in (CONTENT_DIR / "scenarios").glob("*.yaml"))
    return {
        "balance": balance().model_dump(mode="json"),
        "observations": observations().model_dump(mode="json"),
        "scenarios": {name: load_scenario(name, seed=0).model_dump(mode="json") for name in scenarios},
    }


def build() -> Path:
    page = (WEB / "index.html").read_text(encoding="utf-8")
    content = json.dumps(content_bundle(), separators=(",", ":")).replace("</", "<\\/")
    for marker, value in (
        ("/*__CONTENT__*/", content),
        ("/*__ENGINE__*/", (WEB / "engine.js").read_text(encoding="utf-8")),
        ("/*__APP__*/", (WEB / "app.js").read_text(encoding="utf-8")),
    ):
        if marker not in page:
            raise SystemExit(f"web/index.html is missing {marker}")
        page = page.replace(marker, value)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    return OUT


if __name__ == "__main__":
    print(f"Wrote {build().relative_to(ROOT)}")
