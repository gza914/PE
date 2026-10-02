import json

import pytest

from consigliere.engine.commands import EndMonth, apply
from consigliere.engine.state import (
    SCHEMA_VERSION,
    SaveError,
    from_json,
    load_game,
    migrate,
    save_game,
    to_json,
)


def test_round_trip_is_identical(game, tmp_path):
    state, rng = game
    for _ in range(3):
        apply(state, rng, EndMonth())
    path = tmp_path / "save.json"
    save_game(state, rng, path)
    loaded, loaded_rng = load_game(path)
    assert loaded.model_dump(exclude={"rng_state"}) == state.model_dump(exclude={"rng_state"})
    assert loaded_rng.get_state() == rng.get_state()


def test_loaded_game_continues_identically(game):
    state, rng = game
    loaded, loaded_rng = from_json(to_json(state, rng))
    assert [rng.random() for _ in range(10)] == [loaded_rng.random() for _ in range(10)]
    apply(state, rng, EndMonth())
    apply(loaded, loaded_rng, EndMonth())
    assert loaded.month == state.month


def test_save_records_schema_version(game):
    data = json.loads(to_json(*game))
    assert data["schema_version"] == SCHEMA_VERSION


def test_saving_does_not_change_live_state(game):
    state, rng = game
    to_json(state, rng)
    assert state.rng_state is None


def test_migrations_run_in_order():
    calls = []

    def v0_to_v1(data):
        calls.append(0)
        old = data.pop("old")
        return {**data, "renamed": old}

    def v1_to_v2(data):
        calls.append(1)
        return {**data, "added": True}

    result = migrate({"schema_version": 0, "old": 5}, target=2, migrations={0: v0_to_v1, 1: v1_to_v2})
    assert calls == [0, 1]
    assert result == {"schema_version": 2, "renamed": 5, "added": True}


def test_missing_migration_raises():
    with pytest.raises(SaveError):
        migrate({"schema_version": 0}, target=1, migrations={})


def test_newer_save_rejected(game):
    data = json.loads(to_json(*game))
    data["schema_version"] = SCHEMA_VERSION + 1
    with pytest.raises(SaveError):
        from_json(json.dumps(data))


def test_garbage_rejected():
    with pytest.raises(SaveError):
        from_json("not json")
