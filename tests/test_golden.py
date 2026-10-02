"""Golden-seed regression. If a deliberate balance or content change moves these numbers,
rerun the scenario, check the new values look sane, and update them here."""

from consigliere.engine.scenario import new_game
from consigliere.engine.turn import tick


def test_seed_1234_first_year_with_a_silent_consigliere():
    state, rng = new_game(1234)
    for _ in range(12):
        tick(state, rng)
    family = state.player_family
    assert (family.treasury, family.cohesion, family.heat) == (24579, 59, 18)
    assert {c.id: c.stats.loyalty for c in state.members(family.id)} == {
        "don_ferrante": 100,
        "underboss_lauro": 68,
        "you": 80,
        "capo_amaro": 87,
        "capo_tessaro": 37,
        "capo_marchetti": 57,
        "capo_sabella": 55,
    }
    assert len(state.knowledge.ledger) == 12
    assert len(state.knowledge.reports) == 3
    assert len(state.knowledge.decisions) == 26
    assert (state.standing.dons_trust, state.don_mood, len(state.matters)) == (46, 53, 3)
    assert {k: (v.stage, v.tension) for k, v in state.rivalries.items()} == {"brancato": (0, 33), "orsini": (0, 1)}
