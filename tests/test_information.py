import json

import pytest

from consigliere.engine import matters
from consigliere.engine.commands import CommandError, Recommend, Verify, apply
from consigliere.engine.content import events
from consigliere.engine.eventdefs import Effect, EventDef, IntelDef
from consigliere.engine.models import Allegiance, MatterIntel, Source
from consigliere.engine.rng import GameRNG
from consigliere.engine.state import from_json, to_json
from tests.helpers import tuned


@pytest.fixture
def fresh(game):
    state, rng = game
    state.matters = []
    state.event_log = {}
    return state, rng


def intel(**extra):
    data = {"claim": "It is so.", "denial": "It is not so.", "truth": [["flag.so", "==", 1]], "sources": ["street"]}
    data.update(extra)
    return IntelDef.model_validate(data)


def only_source(state, source_id, reliability=1.0, compromised=False):
    for s in state.sources.values():
        s.active = s.id == source_id
    state.sources[source_id].reliability = reliability
    state.sources[source_id].compromised = compromised


# ---- conditions, secrets, names ----

def test_any_condition(fresh):
    state, _ = fresh
    b = {"capo": "capo_amaro"}
    assert matters.check(state, b, {"any": [["capo.loyalty", "<", 0], ["capo", "has", "loyal"]]})
    assert not matters.check(state, b, {"any": [["capo.loyalty", "<", 0], ["capo", "has", "greedy"]]})


def test_secrets_are_rolled_once_and_read_as_conditions(fresh):
    state, _ = fresh
    e = EventDef.model_validate({"id": "s", "title": "t", "text": "t", "secrets": {"always": 1.0, "never": 0.0},
                                 "options": [{"id": "a", "label": "A", "outcomes": [{"tone": "neutral", "text": "."}]},
                                             {"id": "b", "label": "B", "outcomes": [{"tone": "neutral", "text": "."}]}]})
    b = {}
    matters.roll_secrets(e, b, GameRNG(0))
    assert matters.lookup(state, b, "secret.always") == 1 and matters.lookup(state, b, "secret.never") == 0
    b["?always"] = "no"
    matters.roll_secrets(e, b, GameRNG(0))
    assert b["?always"] == "no"  # inherited secrets are kept
    assert matters.fill("x", state, b) == "x" and matters.bindings_alive(state, b)


def test_lists_render_sorted_so_slot_order_never_shows(fresh):
    state, _ = fresh
    b = {"a": "capo_tessaro", "b": "capo_amaro", "c": "capo_sabella"}
    assert matters.fill("{them}", state, b, {"them": ["a", "b", "c"]}) == "Augie Sabella, Frank Tessaro and Vito Amaro"


# ---- new effects ----

def apply_fx(state, rng, bindings, **effect):
    matters.apply_effect(state, Effect.model_validate(effect), bindings, rng, events()["rat_warning"], "Test")


def test_assign_roles_shuffles_the_pool_into_roles(fresh):
    state, _ = fresh
    seen = set()
    for seed in range(20):
        b = {"a": "capo_amaro", "b": "capo_tessaro", "c": "capo_sabella"}
        apply_fx(state, GameRNG(seed), b, assign_roles={"pool": ["a", "b", "c"], "roles": ["rat", "hiding", "innocent"]})
        assert {b["rat"], b["hiding"], b["innocent"]} == {"capo_amaro", "capo_tessaro", "capo_sabella"}
        seen.add(b["rat"])
    assert len(seen) == 3


def test_allegiance_compromises_a_character_source(fresh):
    state, rng = fresh
    lauro = state.sources["lauro"]
    assert not matters.is_compromised(state, lauro)
    apply_fx(state, rng, {"rat": "underboss_lauro"}, allegiance={"who": "rat", "to": "informant", "agency": "fbi"})
    assert state.characters["underboss_lauro"].hidden.allegiance is Allegiance.INFORMANT
    assert matters.is_compromised(state, lauro)


def test_retire_unassigns_rackets_and_silences_his_source(fresh):
    state, rng = fresh
    apply_fx(state, rng, {"rat": "underboss_lauro", "capo": "capo_sabella"}, retire="capo")
    assert not state.characters["capo_sabella"].alive
    assert all(r.capo_id != "capo_sabella" for r in state.rackets.values())
    apply_fx(state, rng, {"rat": "underboss_lauro"}, retire="rat")
    assert "lauro" not in [s.id for s in matters.usable_sources(state)]


def test_add_compromise_and_remove_source(fresh):
    state, rng = fresh
    apply_fx(state, rng, {}, add_source={"id": "hack", "name": "A hack", "kind": "press", "reliability": 0.9, "believed": 0.3})
    assert state.sources["hack"].reliability == 0.9
    assert state.knowledge.sources["hack"].believed == 0.3
    assert "reliability" not in state.knowledge.sources["hack"].model_dump()
    apply_fx(state, rng, {}, compromise_source="hack")
    assert matters.is_compromised(state, state.sources["hack"])
    apply_fx(state, rng, {}, remove_source="hack")
    assert not state.knowledge.sources["hack"].active


# ---- reports ----

def test_honest_reliable_source_tells_the_truth(fresh):
    state, rng = fresh
    only_source(state, "nunzio", reliability=1.0)
    state.flags["so"] = 0
    report = matters.report_on(state, rng, intel(), {}, None, set())
    assert (report.source_id, report.says) == ("nunzio", True)
    state.flags.pop("so")
    assert matters.report_on(state, rng, intel(), {}, None, set()).says is False


def test_compromised_source_always_inverts(fresh):
    state, rng = fresh
    only_source(state, "nunzio", reliability=1.0, compromised=True)
    state.flags["so"] = 0
    assert all(not matters.report_on(state, rng, intel(), {}, None, set()).says for _ in range(10))


def test_nobody_reports_on_himself_and_kinds_fall_back(fresh):
    state, rng = fresh
    only_source(state, "lauro")
    assert matters.report_on(state, rng, intel(sources=["street"]), {}, "underboss_lauro", set()) is None
    report = matters.report_on(state, rng, intel(sources=["street"]), {}, None, set())
    assert report.source_id == "lauro"  # no street source left, so family speaks up


def test_apparent_trust_moves_with_the_record(fresh):
    state, _ = fresh
    known = state.knowledge.sources["nunzio"]
    bal = tuned()
    first = matters.apparent_trust(known, bal)
    assert first == pytest.approx(known.believed)
    known.right += 6
    assert matters.apparent_trust(known, bal) > first
    known.wrong += 20
    assert matters.apparent_trust(known, bal) < first


# ---- verification and revealing ----

def matter_with_intel(state, rng, claim_sources=("street",)):
    e = events()["raid_tip"]
    m = matters.make_matter(e, {}, state, rng)
    state.matters = [m]
    return m


def test_matter_arrives_with_a_report(fresh):
    state, rng = fresh
    m = matter_with_intel(state, rng)
    [item] = m.intel
    assert item.claim == "The vice squad really is coming on Friday."
    assert len(item.reports) == 1
    assert m.bindings["?raid_real"] in ("yes", "no")


def test_verify_spends_influence_and_asks_someone_new(fresh):
    state, rng = fresh
    m = matter_with_intel(state, rng)
    first = m.intel[0].reports[0].source_id
    before = state.standing.influence
    apply(state, rng, Verify(matter_id=m.id, intel_index=0))
    assert state.standing.influence == before - tuned().information.verify_cost
    assert len(m.intel[0].reports) == 2 and m.intel[0].reports[1].source_id != first


def test_verify_refuses_without_influence_or_sources(fresh):
    state, rng = fresh
    m = matter_with_intel(state, rng)
    state.standing.influence = 0
    with pytest.raises(CommandError):
        apply(state, rng, Verify(matter_id=m.id, intel_index=0))
    state.standing.influence = 100
    for _ in range(10):
        if not matters.can_verify(state, m, 0):
            break
        apply(state, rng, Verify(matter_id=m.id, intel_index=0))
    assert not matters.can_verify(state, m, 0)
    ids = [r.source_id for r in m.intel[0].reports]
    assert len(ids) == len(set(ids)) == len(matters.usable_sources(state))
    with pytest.raises(CommandError):
        apply(state, rng, Verify(matter_id=m.id, intel_index=5))


def test_reveal_updates_the_record(fresh):
    state, rng = fresh
    m = matter_with_intel(state, rng)
    report = m.intel[0].reports[0]
    known = state.knowledge.sources[report.source_id]
    e = events()["raid_tip"]  # reveal: 1.0
    lines = matters.reveal(state, rng, m, e, tuned())
    truth = m.bindings["?raid_real"] == "yes"
    assert (known.right, known.wrong) == ((1, 0) if report.says == truth else (0, 1))
    assert lines[0].startswith("It came out: ")
    assert known.name in lines[0]


def test_reveal_zero_keeps_the_secret(fresh):
    state, rng = fresh
    e = events()["rat_warning"]
    m = matters.make_matter(e, {"a": "capo_amaro", "b": "capo_tessaro", "c": "capo_sabella"}, state, rng)
    assert matters.reveal(state, rng, m, e, tuned()) == []


def test_settling_a_matter_records_what_came_out(fresh):
    state, rng = fresh
    m = matter_with_intel(state, rng)
    apply(state, rng, Recommend(matter_id=m.id, choice="move"))
    matters.run(state, rng)
    assert state.knowledge.decisions[-1].revealed


# ---- the Rat ----

def warn(state, rng):
    b = {"a": "capo_amaro", "b": "capo_tessaro", "c": "capo_sabella"}
    m = matters.make_matter(events()["rat_warning"], b, state, rng)
    state.matters = [m]
    return m


def test_the_warning_plants_one_rat_and_one_red_herring(fresh):
    state, rng = fresh
    m = warn(state, rng)
    b = m.bindings
    suspects = {b["a"], b["b"], b["c"]}
    informants = [c for c in suspects if state.characters[c].hidden.allegiance is Allegiance.INFORMANT]
    assert informants == [b["rat"]]
    assert "secret_meetings" in state.characters[b["hiding"]].hidden.vices
    assert b["innocent"] not in (b["rat"], b["hiding"])
    assert "rat_active" in state.flags
    assert "Augie Sabella, Frank Tessaro and Vito Amaro" in m.text


def evidence(state, rng, warning):
    m = matters.make_matter(events()["rat_evidence"], dict(warning.bindings), state, rng)
    state.matters = [m]
    return m


def accuse(state, rng, m, who):
    slot = next(s for s in ("a", "b", "c") if m.bindings[s] == m.bindings[who])
    m.recommendation = f"accuse_{slot}"
    matters.run(state, rng, tuned(advice={"follow_min": 1.0, "follow_max": 1.0}))
    return state.knowledge.decisions[-1]


def test_accusing_the_rat_breaks_him(fresh):
    state, rng = fresh
    m = evidence(state, rng, warn(state, rng))
    d = accuse(state, rng, m, "rat")
    assert d.tone == "good" and "rat_known" in state.flags
    assert state.scheduled[-1].event_id == "rat_reckoning"


@pytest.mark.parametrize("who, phrase", [("hiding", "Gloria"), ("innocent", "swears on his children")])
def test_accusing_the_wrong_man_costs_his_loyalty(fresh, who, phrase):
    state, rng = fresh
    m = evidence(state, rng, warn(state, rng))
    target = state.characters[m.bindings[who]]
    before = target.stats.loyalty
    d = accuse(state, rng, m, who)
    assert d.tone == "bad" and phrase in d.text
    assert target.stats.loyalty < before
    assert state.scheduled[-1].event_id == "rat_damage"


def test_the_canary_names_the_rat(fresh):
    state, rng = fresh
    w = warn(state, rng)
    from consigliere.engine.models import Scheduled
    state.scheduled = [Scheduled(event_id="rat_canary", month=state.month, bindings=dict(w.bindings))]
    matters.run_scheduled(state, rng, events())
    news = state.knowledge.news[-1]
    assert state.characters[w.bindings["rat"]].name in news.text
    assert "rat_known" in state.flags


def test_evidence_about_the_rat_and_his_shadow_points_their_way(fresh):
    state, rng = fresh
    for s in state.sources.values():
        s.reliability = 1.0
    w = warn(state, rng)
    m = evidence(state, rng, w)
    said = {item.about: item.reports[0].says for item in m.intel if item.reports
            and not matters.is_compromised(state, state.sources[item.reports[0].source_id])}
    for about, says in said.items():
        assert says == (about in (w.bindings["rat"], w.bindings["hiding"]))


# ---- scenario and saves ----

def test_scenario_splits_truth_from_belief(game):
    state, _ = game
    assert isinstance(state.sources["nunzio"], Source)
    assert state.sources["nunzio"].reliability == 0.8
    assert state.knowledge.sources["nunzio"].believed == 0.45
    assert state.sources["lauro"].character_id == "underboss_lauro"


def test_version_3_save_upgrades(game):
    state, rng = game
    data = json.loads(to_json(state, rng))
    data["schema_version"] = 3
    del data["sources"]
    del data["knowledge"]["sources"]
    for m in data["matters"]:
        del m["intel"]
    loaded, _ = from_json(json.dumps(data))
    assert loaded.sources == {} and all(m.intel == [] for m in loaded.matters)


def test_matter_intel_model_defaults():
    assert MatterIntel(claim="a", denial="b").reports == []
