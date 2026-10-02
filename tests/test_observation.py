from consigliere.engine.content import observations
from consigliere.engine.rng import GameRNG
from consigliere.engine.systems import observation
from tests.helpers import tuned

ALWAYS = tuned(observation={"base_notice": 1.0, "indiscretion_weight": 0.0})
NEVER = tuned(observation={"base_notice": 0.0, "indiscretion_weight": 0.0})


def test_starting_impressions_are_accurate(game):
    state, _ = game
    obs = observations()
    watched = observation.watched(state)
    assert {m.id for m in watched} == {"underboss_lauro", "capo_amaro", "capo_tessaro", "capo_marchetti", "capo_sabella"}
    for member in watched:
        assert state.knowledge.impressions[member.id] == obs.band_for(member.stats.loyalty).id


def test_noticed_shift_becomes_a_report(game):
    state, _ = game
    sabella = state.characters["capo_sabella"]
    sabella.stats.loyalty = 5
    observation.run(state, GameRNG(0), ALWAYS)
    assert state.knowledge.impressions["capo_sabella"] == "estranged"
    [report] = state.knowledge.reports
    assert report.subject_id == "capo_sabella"
    assert "Augie Sabella" in report.claim and "{name}" not in report.claim
    assert report.source_id == state.player_id
    assert report.confidence == ALWAYS.observation.confidence


def test_unnoticed_shift_leaves_impression_stale(game):
    state, _ = game
    state.characters["capo_sabella"].stats.loyalty = 5
    observation.run(state, GameRNG(0), NEVER)
    assert state.knowledge.impressions["capo_sabella"] == "steady"
    assert state.knowledge.reports == []


def test_no_shift_no_report(game):
    state, _ = game
    observation.run(state, GameRNG(0), ALWAYS)
    assert state.knowledge.reports == []
