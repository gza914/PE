from consigliere.engine.calendar import month_label
from consigliere.engine.commands import EndMonth, apply
from consigliere.engine.scenario import new_game
from consigliere.engine.turn import tick


def test_tick_advances_one_month(game):
    state, rng = game
    tick(state, rng)
    assert state.month == 1


def test_systems_run_in_order_before_month_advances(game):
    state, rng = game
    seen = []
    systems = [lambda s, r: seen.append(("a", s.month)), lambda s, r: seen.append(("b", s.month))]
    tick(state, rng, systems)
    assert seen == [("a", 0), ("b", 0)]
    assert state.month == 1


def test_end_month_command(game):
    state, rng = game
    for _ in range(12):
        apply(state, rng, EndMonth())
    assert month_label(state.month) == "January 1959"


def test_golden_seed_is_deterministic():
    def play(seed):
        state, rng = new_game(seed)
        for _ in range(24):
            if state.ending is not None:
                break
            apply(state, rng, EndMonth())
        return state.model_dump(), rng.get_state()

    assert play(99) == play(99)


def test_month_labels():
    assert month_label(0) == "January 1958"
    assert month_label(11) == "December 1958"
    assert month_label(14 * 12 + 11) == "December 1972"
