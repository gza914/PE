from consigliere.engine.models import Memory
from consigliere.engine.rng import GameRNG
from consigliere.engine.systems import characters
from tests.helpers import tuned


def test_memories_decay_and_are_forgotten(game):
    state, _ = game
    sal = state.characters["underboss_lauro"]
    sal.memory = [
        Memory(event_id="favor", month=0, weight=10, decay_rate=0.5),
        Memory(event_id="betrayal", month=0, weight=-10, decay_rate=0.01),
    ]
    for _ in range(6):
        characters.decay_memories(sal, forget_below=0.5)
    assert [m.event_id for m in sal.memory] == ["betrayal"]
    assert -10 < sal.memory[0].weight < -9


def test_loyalty_drifts_to_target(game):
    state, _ = game
    bal = tuned(loyalty={"noise": 0, "cohesion_weight": 0})
    tessaro = state.characters["capo_tessaro"]
    target = characters.loyalty_target(tessaro, state.player_family, state.characters["don_ferrante"], bal.loyalty)
    tessaro.stats.loyalty = 100
    rng = GameRNG(3)
    for _ in range(80):
        characters.run(state, rng, bal)
    assert abs(tessaro.stats.loyalty - target) <= 2


def test_slights_lower_the_target(game):
    state, _ = game
    lb = tuned().loyalty
    family, don = state.player_family, state.characters["don_ferrante"]
    sabella = state.characters["capo_sabella"]
    before = characters.loyalty_target(sabella, family, don, lb)
    sabella.memory.append(Memory(event_id="stipend_missed", about_id=family.id, month=0, weight=-50))
    after = characters.loyalty_target(sabella, family, don, lb)
    assert after == before - lb.memory_cap


def test_traits_shape_the_target(game):
    state, _ = game
    lb = tuned().loyalty
    family, don = state.player_family, state.characters["don_ferrante"]
    amaro = characters.loyalty_target(state.characters["capo_amaro"], family, don, lb)
    tessaro = characters.loyalty_target(state.characters["capo_tessaro"], family, don, lb)
    assert amaro > tessaro


def test_don_and_player_do_not_drift(game):
    state, rng = game
    don, you = state.characters["don_ferrante"], state.player
    before = (don.stats.loyalty, you.stats.loyalty)
    for _ in range(24):
        characters.run(state, rng)
    assert (don.stats.loyalty, you.stats.loyalty) == before


def test_cohesion_follows_mean_loyalty(game):
    state, rng = game
    bal = tuned(loyalty={"noise": 0, "drift_rate": 0})
    for member in state.members(state.player_family.id):
        if member.id not in ("don_ferrante", "you"):
            member.stats.loyalty = 20
    for _ in range(60):
        characters.run(state, rng, bal)
    assert state.player_family.cohesion <= 22
