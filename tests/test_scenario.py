from consigliere.engine.models import Role


def test_default_scenario_is_consistent(game):
    state, _ = game
    assert state.month == 0
    assert state.player.role is Role.CONSIGLIERE
    family = state.player_family
    assert state.characters[family.don_id].role is Role.DON
    for member_id in family.member_ids:
        assert state.characters[member_id].family_id == family.id
    for edge in state.relationships:
        assert edge.src in state.characters and edge.dst in state.characters
