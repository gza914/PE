import json

import pytest

from consigliere.engine import lifecycle, matters, world
from consigliere.engine.content import difficulties, events
from consigliere.engine.eventdefs import Effect
from consigliere.engine.models import Investigation
from consigliere.engine.rng import GameRNG
from consigliere.engine.scenario import new_game
from consigliere.engine.state import from_json, to_json
from tests.helpers import tuned


def test_difficulty_sets_the_start():
    normal, _ = new_game(1)
    easy, _ = new_game(1, difficulty="easy")
    hard, _ = new_game(1, difficulty="hard")
    assert easy.player_family.treasury > normal.player_family.treasury > hard.player_family.treasury
    assert easy.standing.dons_trust > normal.standing.dons_trust > hard.standing.dons_trust
    assert (easy.difficulty, hard.difficulty) == ("easy", "hard")


def test_difficulty_changes_the_dons_ear_and_the_laws_pace():
    states = {d: new_game(1, difficulty=d)[0] for d in difficulties()}
    don = states["normal"].characters["don_ferrante"]
    for s in states.values():
        s.standing.dons_trust = 50
    chances = {d: matters.follow_chance(s, don, tuned()) for d, s in states.items()}
    assert chances["easy"] > chances["normal"] > chances["hard"]
    progress = {}
    for d, s in states.items():
        for r in s.rackets.values():
            r.heat = 60 if r.capo_id == "capo_tessaro" else 0
        s.investigations["capo_tessaro"] = Investigation(id="i", target_id="capo_tessaro", agency="fbi", opened_month=0)
        world.run_law(s, GameRNG(0), tuned())
        progress[d] = s.investigations["capo_tessaro"].progress
    assert progress["easy"] < progress["normal"] < progress["hard"]


def test_the_tutorial_opens_with_a_gentle_matter():
    state, _ = new_game(2, tutorial=True)
    assert "first_morning" in [m.event_id for m in state.matters]
    plain, _ = new_game(2)
    assert "first_morning" not in [m.event_id for m in plain.matters]


def test_the_papers_print_every_month_and_the_family_makes_headlines(game):
    state, rng = game
    from consigliere.engine.turn import tick
    for _ in range(3):
        tick(state, rng)
    city = [h for h in state.knowledge.papers if not h.family]
    assert len(city) == 3
    from consigliere.engine.models import Scheduled
    state.scheduled = [Scheduled(event_id="indicted", month=state.month, bindings={"man": "capo_amaro"})]
    matters.run_scheduled(state, rng, events())
    assert state.knowledge.papers[-1].family and "Vito Amaro" in state.knowledge.papers[-1].text


def fx(state, rng, bindings, **effect):
    matters.apply_effect(state, Effect.model_validate(effect), bindings, rng, events()["light_envelope"], "Test")


def test_racket_and_promotion_effects(game):
    state, rng = game
    b = {"district": "fulton", "capo": "capo_amaro"}
    fx(state, rng, b, add_racket={"id": "dope", "name": "A new trade", "kind": "narcotics", "district": "district",
                                   "capo": "capo", "income": 9000, "heat_per_month": 8, "bind": "dope"})
    assert state.rackets["dope"].capo_id == "capo_amaro" and b["dope"] == "dope"
    fx(state, rng, b, remove_racket="dope")
    assert "dope" not in state.rackets
    fx(state, rng, {"man": "you"}, promote={"who": "man", "role": "capo"})
    assert state.player.role.value == "capo"


def test_crew_size_counts_only_men_who_could_lead(game):
    state, _ = game
    assert lifecycle.crew_size(state) == 5
    state.characters["capo_amaro"].role = "family_member"
    assert lifecycle.crew_size(state) == 4


def test_version_7_save_upgrades(game):
    state, rng = game
    data = json.loads(to_json(state, rng))
    data["schema_version"] = 7
    del data["difficulty"]
    del data["knowledge"]["papers"]
    loaded, _ = from_json(json.dumps(data))
    assert loaded.difficulty == "normal" and loaded.knowledge.papers == []


@pytest.mark.parametrize("difficulty", ["easy", "normal", "hard"])
def test_every_difficulty_finishes(difficulty):
    from consigliere.engine.turn import tick
    state, rng = new_game(4, difficulty=difficulty)
    for _ in range(200):
        tick(state, rng)
    assert state.ending is not None
