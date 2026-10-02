from consigliere.cli import main, run


def scripted(lines):
    it = iter(lines)

    def read(_prompt):
        try:
            return next(it)
        except StopIteration:
            raise EOFError

    return read


def test_loop_advances_saves_and_loads(game, tmp_path):
    state, rng = game
    out = []
    save = tmp_path / "s.json"
    run(state, rng, scripted(["n", "n", f"s {save}", "n", f"l {save}", "q"]), out.append)
    text = "\n".join(out)
    assert "March 1958" in text
    assert "April 1958" in text
    assert f"Loaded {save}." in text
    assert out[-1].startswith("March 1958")  # back to the saved month after loading


def test_bad_load_reports_error(game, tmp_path):
    out = []
    run(*game, scripted([f"l {tmp_path / 'missing.json'}", "q"]), out.append)
    assert any("Could not load" in line for line in out)


def test_main_with_seed(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", scripted(["n", "q"]))
    main(["--seed", "5"])
    assert "February 1958" in capsys.readouterr().out


def test_next_month_prints_report(game):
    out = []
    run(*game, scripted(["n", "q"]), out.append)
    text = "\n".join(out)
    assert "=== January 1958" in text
    assert "Pier 9 (Augie Sabella)" in text
    assert "Total in" in text and "Total out" in text


def test_report_shows_what_you_noticed(game):
    from consigliere.cli import monthly_report
    from consigliere.engine.commands import EndMonth, apply
    from consigliere.engine.models import Report

    state, rng = game
    apply(state, rng, EndMonth())
    state.knowledge.reports.append(
        Report(id="r", subject_id="capo_amaro", claim="Vito Amaro was at Mass.", source_id="you", month=0, confidence=0.6)
    )
    assert "  - Vito Amaro was at Mass." in monthly_report(state, 0)


def test_family_view_shows_readings_not_numbers(game):
    from consigliere.cli import family_view

    state, _ = game
    text = "\n".join(family_view(state))
    assert "Capo Frank Tessaro (cooling)" in text
    assert "Social club card games" in text
    assert str(state.characters["capo_tessaro"].stats.loyalty) not in text


def test_desk_and_advice(game):
    state, rng = game
    out = []
    first = state.matters[0]
    run(state, rng, scripted(["d", "a 1 1", "a 1 x", "n", "q"]), out.append)
    text = "\n".join(out)
    assert f"[1] {first.title}" in text
    assert f"Noted for {first.title}." in text
    assert "Usage: a <matter number>" in text
    assert "The Don's decisions" in text
    assert f"you advised: {first.options[0].label}" in text


def test_intel_and_verify(game):
    from consigliere.engine.scenario import new_game

    for seed in range(50):
        state, rng = new_game(seed)
        if any(m.intel for m in state.matters):
            break
    n = next(i for i, m in enumerate(state.matters, 1) if m.intel)
    out = []
    run(state, rng, scripted(["d", f"v {n} 1", "v 9 9", "q"]), out.append)
    text = "\n".join(out)
    assert "What you've heard:" in text and "% trusted)" in text
    assert "You ask around. Influence now 17." in text
    assert "Usage: v <matter number> <intel number>" in text


def test_ending_is_shown_instead_of_another_month(game):
    state, rng = game
    state.flags["retire"] = 0
    state.player_family.treasury = 500_000
    out = []
    run(state, rng, scripted(["n", "n", "q"]), out.append)
    text = "\n".join(out)
    assert "=== Retired, with the family intact" in text
    assert "Ranked 1 of the ways this can end." in text
