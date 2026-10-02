import pytest

from consigliere.engine.scenario import new_game


@pytest.fixture
def game():
    return new_game(seed=1234)
