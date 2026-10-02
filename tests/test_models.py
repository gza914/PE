import pytest
from pydantic import ValidationError

from consigliere.engine.models import Character, EventDef, Role, Standing, Stats


def make_character(**overrides):
    data = {
        "id": "c1", "name": "Vito Amaro", "role": "capo",
        "traits": ["greedy", "loyal", "cautious"],
        "hidden": {"birth_year": 1920},
    }
    return Character.model_validate({**data, **overrides})


def test_character_defaults():
    c = make_character()
    assert c.role is Role.CAPO
    assert c.stats.loyalty == 50
    assert c.hidden.health == 100
    assert c.alive


@pytest.mark.parametrize("traits", [["greedy", "loyal"], ["greedy"] * 6])
def test_character_needs_three_to_five_traits(traits):
    with pytest.raises(ValidationError):
        make_character(traits=traits)


def test_unknown_trait_rejected():
    with pytest.raises(ValidationError):
        make_character(traits=["greedy", "loyal", "telepathic"])


def test_stats_bounded_0_to_100():
    with pytest.raises(ValidationError):
        Stats(loyalty=101)
    with pytest.raises(ValidationError):
        Stats(fear=-1)


def test_assignment_is_validated():
    s = Standing()
    with pytest.raises(ValidationError):
        s.exposure = 150


def test_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        make_character(nickname="The Knife")


def test_event_needs_two_to_four_options():
    base = {"id": "e1", "text": "A man waits in the outer office."}
    with pytest.raises(ValidationError):
        EventDef.model_validate({**base, "options": [{"id": "a", "text": "See him"}]})
    event = EventDef.model_validate(
        {**base, "options": [{"id": "a", "text": "See him"}, {"id": "b", "text": "Let him wait"}]}
    )
    assert len(event.options) == 2
