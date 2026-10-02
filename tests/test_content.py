from consigliere.engine.content import balance, observations
from consigliere.engine.models import Role


def test_balance_loads():
    assert 0 < balance().economy.capo_share < 1


def test_bands_cover_every_loyalty():
    obs = observations()
    for loyalty in range(101):
        obs.band_for(loyalty)
    ids = [b.id for b in obs.loyalty_bands]
    assert len(ids) == len(set(ids))


def test_every_observation_names_its_subject():
    for band in observations().loyalty_bands:
        for line in band.lines:
            assert "{name}" in line
            line.format(name="X")


def test_default_scenario_has_milestone_two_cast(game):
    state, _ = game
    family = state.player_family
    capos = [m for m in state.members(family.id) if m.role is Role.CAPO]
    assert len(capos) == 4
    assert len(state.rackets) == 6
    for racket in state.rackets.values():
        assert state.characters[racket.capo_id].role is Role.CAPO
        assert racket.capo_id in family.member_ids
    assert any(e.stipend for e in family.expenses)
