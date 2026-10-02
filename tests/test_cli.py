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
