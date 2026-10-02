"""Golden-seed regression. If a deliberate balance or content change moves these numbers,
rerun the scenario, check the new values look sane, and update them here."""

from consigliere.engine.scenario import new_game
from consigliere.engine.turn import tick


def test_seed_1234_first_year_with_a_silent_consigliere():
    state, rng = new_game(1234)
    for _ in range(12):
        tick(state, rng)
    assert state.player_family.treasury == 66637
    assert state.player_family.cohesion == 68
    assert {c.id: c.stats.loyalty for c in state.characters.values()} == {
        "don_ferrante": 100,
        "underboss_lauro": 74,
        "you": 80,
        "capo_amaro": 96,
        "capo_tessaro": 50,
        "capo_marchetti": 79,
        "capo_sabella": 54,
    }
    assert len(state.knowledge.ledger) == 12
    assert len(state.knowledge.reports) == 1
    assert len(state.knowledge.decisions) == 14
    assert (state.standing.dons_trust, state.don_mood, len(state.matters)) == (50, 50, 1)
