"""The balance harness: bots play legal games, results are reproducible, the report adds up."""

import json

from tools.bots import STRATEGIES
from tools.simulate import main, play, render, summarize


def test_every_strategy_plays_a_legal_game():
    for name in STRATEGIES:
        result = play(name, seed=3, months=30)
        assert result["strategy"] == name and 1 <= result["months"] <= 30
        assert result["fired"], "something should have happened"


def test_runs_are_reproducible():
    assert play("random", 5, 40) == play("random", 5, 40)
    assert play("cautious", 5, 40) == play("cautious", 5, 40)


def test_full_game_reaches_an_ending():
    result = play("paper", seed=1)
    assert result["ending"] != "unfinished" and result["rank"] is not None


def test_summary_and_bug_rules():
    fake = [
        {"strategy": "x", "seed": i, "months": 100, "ending": "retired_intact", "rank": 1, "treasury_by_year": {0: 1000},
         "wars": 0, "war_months": 0, "fired": ["light_envelope"], "final_trust": 80, "rat_found": True}
        for i in range(10)
    ]
    report = summarize(fake)
    s = report["strategies"]["x"]
    assert s["win_rate"] == 1.0 and s["treasury_by_year"] == {1958: 1000}
    assert any("wins 100%" in b for b in report["bugs"])
    assert any("never fired" in b for b in report["bugs"])
    assert "succession_pair" in report["never_fired"]
    assert not any("succession_pair" in b for b in report["bugs"])  # rare by design
    text = render(report, 10, 1.0)
    assert "| x | 100% ⚠ |" in text and "Rare fallbacks" in text


def test_cli_writes_reports(tmp_path, capsys):
    out_json, out_md = tmp_path / "r.json", tmp_path / "r.md"
    code = main(["--runs", "2", "--months", "12", "--jobs", "1", "--strategies", "cautious,random",
                 "--json", str(out_json), "--report", str(out_md)])
    assert code == 0
    report = json.loads(out_json.read_text())
    assert set(report["strategies"]) == {"cautious", "random"}
    assert out_md.read_text().startswith("# Balance report: 2 runs per strategy")
    assert "Balance report" in capsys.readouterr().out
