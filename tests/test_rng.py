from consigliere.engine.rng import GameRNG


def draws(rng: GameRNG) -> list:
    return [rng.random(), rng.randint(1, 100), rng.choice("abcdef"), rng.chance(0.5),
            rng.uniform(-1, 1), rng.weighted_choice(["x", "y"], [1, 3])]


def test_same_seed_same_sequence():
    assert draws(GameRNG(42)) == draws(GameRNG(42))


def test_different_seeds_differ():
    assert [GameRNG(1).random() for _ in range(5)] != [GameRNG(2).random() for _ in range(5)]


def test_state_round_trip_continues_sequence():
    rng = GameRNG(7)
    draws(rng)
    restored = GameRNG.from_state(rng.get_state())
    assert draws(restored) == draws(rng)


def test_state_is_json_friendly():
    import json

    state = GameRNG(7).get_state()
    assert json.loads(json.dumps(state)) == state
