"""Enforce the architecture rules from CLAUDE.md."""

import ast
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent / "consigliere" / "engine"


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = "." * node.level + (node.module or "")
            names.add(base)
            # catches "from .. import ui" as well as "from ..ui import x"
            names.update(f"{base}.{alias.name}" for alias in node.names)
    return names


def engine_files():
    return sorted(ENGINE.rglob("*.py"))


def test_engine_never_imports_ui_or_llm():
    for path in engine_files():
        for name in imported_modules(path):
            parts = name.lstrip(".").split(".")
            assert "ui" not in parts and "llm" not in parts and "cli" not in parts, (
                f"{path.relative_to(ENGINE)} imports {name}"
            )


def test_random_only_in_rng_module():
    for path in engine_files():
        if path.name == "rng.py" and path.parent == ENGINE:
            continue
        mods = imported_modules(path)
        assert "random" not in mods and "secrets" not in mods, (
            f"{path.relative_to(ENGINE)} imports random directly; use engine/rng.py"
        )
