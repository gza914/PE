"""Golden-seed regression. If a deliberate balance or content change moves these numbers,
rerun the scenario, check the new values look sane, and update them here."""

from consigliere.engine.scenario import new_game
from consigliere.engine.turn import tick


def test_seed_1234_first_year_with_a_silent_consigliere():
    state, rng = new_game(1234)
    for _ in range(12):
        tick(state, rng)
    family = state.player_family
    assert (family.treasury, family.cohesion, family.heat) == (45332, 67, 16)
    assert {c.id: c.stats.loyalty for c in state.members(family.id)} == {
        "don_ferrante": 100,
        "underboss_lauro": 68,
        "you": 80,
        "capo_amaro": 90,
        "capo_tessaro": 52,
        "capo_marchetti": 71,
        "capo_sabella": 52,
        "capo_11_7": 77,
    }
    assert len(state.knowledge.ledger) == 12
    assert len(state.knowledge.reports) == 1
    assert len(state.knowledge.decisions) == 26
    assert len(state.knowledge.papers) >= 12
    assert (state.standing.dons_trust, state.don_mood, len(state.matters)) == (38, 55, 1)
    assert {k: (v.stage, v.tension) for k, v in state.rivalries.items()} == {"brancato": (1, 51), "orsini": (0, 0)}
