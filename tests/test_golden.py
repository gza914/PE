"""Golden-seed regression. If a deliberate balance or content change moves these numbers,
rerun the scenario, check the new values look sane, and update them here."""

from consigliere.engine.scenario import new_game
from consigliere.engine.turn import tick


def test_seed_1234_first_year():
    state, rng = new_game(1234)
    for _ in range(12):
        tick(state, rng)
    assert state.player_family.treasury == 85782
    assert state.player_family.cohesion == 66
    assert {c.id: c.stats.loyalty for c in state.characters.values()} == {
        "don_ferrante": 100,
        "underboss_lauro": 73,
        "you": 80,
        "capo_amaro": 87,
        "capo_tessaro": 48,
        "capo_marchetti": 77,
        "capo_sabella": 58,
    }
    assert len(state.knowledge.ledger) == 12
    assert len(state.knowledge.reports) == 1
