import json

import pytest

from consigliere.engine import matters, world
from consigliere.engine.commands import CommandError, SitDownAct, apply
from consigliere.engine.content import events
from consigliere.engine.eventdefs import Effect
from consigliere.engine.models import Investigation, InvestigationStage
from consigliere.engine.rng import GameRNG
from consigliere.engine.state import from_json, to_json
from tests.helpers import tuned


@pytest.fixture
def fresh(game):
    state, rng = game
    state.matters = []
    state.event_log = {}
    return state, rng


def fx(state, rng, bindings, **effect):
    matters.apply_effect(state, Effect.model_validate(effect), bindings, rng, events()["rival_insult"], "Test")


# ---- the scenario ----

def test_scenario_has_a_city_and_two_rivals(game):
    state, _ = game
    assert set(state.families) == {"ferrante", "brancato", "orsini"}
    assert set(state.rivalries) == {"brancato", "orsini"}
    for racket in state.rackets.values():
        assert state.districts[racket.district_id].family_id == racket.family_id
    for family in state.families.values():
        assert state.characters[family.don_id].family_id == family.id


def test_engine_scheduled_events_exist():
    for event_id in ("indicted", "investigation_learned", "war_won", "war_lost"):
        assert events()[event_id].kind == "news"
    assert events()["indicted"].even_if_gone


# ---- heat ----

def test_racket_heat_settles_near_its_rate(fresh):
    state, rng = fresh
    bal = tuned()
    for _ in range(120):
        world.run_heat(state, rng, bal)
    pier = state.rackets["docks_pier_9"]
    assert abs(pier.heat - pier.heat_per_month / bal.heat.racket_decay) < 10
    ours = [r.heat for r in state.rackets.values() if r.family_id == "ferrante"]
    assert abs(state.player_family.heat - sum(ours) / len(ours)) < 6


def test_pressure_is_heat_for_capos_family_heat_for_the_don_exposure_for_you(fresh):
    state, _ = fresh
    for r in state.rackets.values():
        r.heat = 10
    state.player_family.heat = 33
    assert world.pressure(state, "capo_tessaro") == 20
    assert world.pressure(state, "don_ferrante") == 33
    assert world.pressure(state, "you") == state.standing.exposure


# ---- the law ----

def hot(state, capo="capo_tessaro", heat=100):
    for r in state.rackets.values():
        r.heat = heat if r.capo_id == capo else 0


def test_hot_capos_draw_investigations(fresh):
    state, rng = fresh
    hot(state)
    bal = tuned(law={"open_max": 1.0, "open_scale": 1})
    world.run_law(state, rng, bal)
    assert "capo_tessaro" in state.investigations
    assert "capo_amaro" not in state.investigations


def test_investigation_climbs_to_indictment_and_jail(fresh):
    state, rng = fresh
    hot(state)
    bal = tuned(law={"open_max": 1.0, "open_scale": 1})
    for _ in range(80):
        world.run_law(state, rng, bal)
        if not state.characters["capo_tessaro"].alive:
            break
    tessaro = state.characters["capo_tessaro"]
    assert tessaro.fate == "jailed"
    assert all(r.capo_id != "capo_tessaro" for r in state.rackets.values())
    support = [e for e in state.player_family.expenses if e.id == "family_of_capo_tessaro"]
    assert support and support[0].stipend
    assert any(s.event_id == "indicted" for s in state.scheduled)


def test_a_cold_investigation_closes(fresh):
    state, rng = fresh
    hot(state, heat=0)
    state.investigations["capo_amaro"] = Investigation(id="i", target_id="capo_amaro", agency="fbi", opened_month=0)
    for _ in range(5):
        world.run_law(state, rng, tuned())
    assert "capo_amaro" not in state.investigations


def test_a_grand_jury_is_public_and_police_sources_help(fresh):
    state, rng = fresh
    hot(state, heat=0)
    state.investigations["capo_amaro"] = Investigation(
        id="i", target_id="capo_amaro", agency="fbi", stage=InvestigationStage.GRAND_JURY, progress=50, opened_month=0)
    world.run_law(state, rng, tuned(law={"learn_base": 0.0}))
    assert state.knowledge.investigations["capo_amaro"].stage == "grand_jury"
    assert not world.honest_police_source(state)
    fx(state, rng, {}, add_source={"id": "cop", "name": "A cop", "kind": "police", "reliability": 0.9, "believed": 0.5})
    assert world.honest_police_source(state)
    fx(state, rng, {}, compromise_source="cop")
    assert not world.honest_police_source(state)


def test_jailing_the_don_raises_the_flag(fresh):
    state, _ = fresh
    world.jail(state, state.characters["don_ferrante"], tuned())
    assert "don_gone" in state.flags


# ---- rivals and war ----

def test_hotheads_heat_up_and_the_cautious_cool_down(fresh):
    state, rng = fresh
    bal = tuned(rivals={"noise": 0.0})
    for _ in range(24):
        world.run_rivals(state, rng, bal)
    assert state.rivalries["brancato"].tension > 40
    assert state.rivalries["orsini"].tension < 10


def test_war_drains_both_sides_until_one_breaks(fresh):
    state, rng = fresh
    state.rivalries["brancato"].stage = world.WAR
    state.families["brancato"].strength = 30
    before = state.player_family.treasury
    for _ in range(40):
        world.run_rivals(state, rng, tuned())
        if state.rivalries["brancato"].stage != world.WAR:
            break
    assert state.rivalries["brancato"].stage == 0
    assert state.player_family.treasury < before
    assert state.scheduled[-1].event_id == "war_won"
    assert state.families["ferrante"].heat > 15


def test_war_end_news_moves_a_district(fresh):
    state, rng = fresh
    from consigliere.engine.models import Scheduled
    state.scheduled = [Scheduled(event_id="war_lost", month=state.month, bindings={"rival": "brancato", "district": "fulton"})]
    matters.run_scheduled(state, rng, events())
    assert state.districts["fulton"].family_id == "brancato"
    assert state.rackets["protection_fulton"].family_id == "brancato"
    assert state.rackets["protection_fulton"].capo_id is None


# ---- cast slots and effects ----

def test_world_cast_slots(fresh):
    state, rng = fresh
    state.rivalries["brancato"].stage, state.rivalries["brancato"].tension = 1, 60
    b = matters.bind(events()["rival_encroach"], state, rng)
    assert b["rival"] == "brancato" and b["boss"] == "don_brancato"
    assert state.districts[b["district"]].family_id == "ferrante"
    assert state.rackets[b["racket"]].district_id == b["district"]
    assert matters.bind(events()["investigation_pressure"], state, rng) is None
    state.investigations["capo_amaro"] = Investigation(id="i", target_id="capo_amaro", agency="fbi", opened_month=0)
    from consigliere.engine.models import KnownInvestigation
    state.knowledge.investigations["capo_amaro"] = KnownInvestigation(target_id="capo_amaro", stage="surveillance", since=0)
    assert matters.bind(events()["investigation_pressure"], state, rng) == {"target": "capo_amaro"}


def test_world_effects(fresh):
    state, rng = fresh
    b = {"rival": "brancato", "district": "river_wards", "boss": "don_brancato", "capo": "capo_amaro"}
    fx(state, rng, b, rivalry={"who": "rival", "stage": 9, "tension": 30})
    assert (state.rivalries["brancato"].stage, state.rivalries["brancato"].tension) == (5, 55)
    fx(state, rng, b, rivalry={"who": "rival", "set_stage": 0})
    assert state.rivalries["brancato"].war_months == 0
    fx(state, rng, b, transfer_district={"district": "district", "to": "family"})
    assert state.rackets["numbers_river"].family_id == "ferrante"
    fx(state, rng, b, strength={"who": "rival", "delta": -20})
    fx(state, rng, b, heat={"who": "family", "delta": 7})
    assert state.families["brancato"].strength == 35 and state.player_family.heat == 22
    fx(state, rng, b, unassign="capo")
    assert all(r.capo_id != "capo_amaro" for r in state.rackets.values())
    fx(state, rng, b, kill="boss")
    assert state.characters["don_brancato"].fate == "killed"
    state.investigations["capo_amaro"] = Investigation(id="i", target_id="capo_amaro", agency="fbi", progress=50, opened_month=0)
    fx(state, rng, b, investigation={"who": "capo", "progress": -80})
    assert state.investigations["capo_amaro"].progress == 0
    fx(state, rng, b, drop_investigation="capo")
    assert "capo_amaro" not in state.investigations


def test_lookups_for_families_districts_and_heat(fresh):
    state, _ = fresh
    b = {"rival": "brancato", "district": "eastside", "capo": "capo_tessaro"}
    assert matters.lookup(state, b, "rival.tension") == 25
    assert matters.lookup(state, b, "rival.treasury") == 18000
    assert matters.lookup(state, b, "district.ours") == 1
    assert matters.lookup(state, b, "strength") == 60
    assert matters.lookup(state, b, "capo.investigation") == 0


# ---- sit-downs ----

def sit(state, rng, **sb):
    world.start_sitdown(state, rng, "brancato", tuned(sitdown=sb) if sb else tuned())
    return state.sitdown


def test_sitdown_opens_above_a_hidden_red_line(fresh):
    state, rng = fresh
    sd = sit(state, rng)
    assert sd.ask > sd.red_line
    view = state.knowledge.sitdown
    assert view.ask == sd.ask and "red_line" not in view.model_dump()
    assert sd.patience == 2  # Brancato is a hothead
    assert "a month" in view.log[0]


def test_conceding_reaches_a_deal_and_a_tribute(fresh):
    state, rng = fresh
    sd = sit(state, rng, red_line_min=0, red_line_max=0, opening_margin_min=500, opening_margin_max=500, broke_discount=0)
    state.rivalries["brancato"].stage = 2
    for _ in range(5):
        if state.sitdown is None:
            break
        apply(state, rng, SitDownAct(action="concede"))
    assert state.sitdown is None and state.knowledge.sitdown is None
    tribute = [e for e in state.player_family.expenses if e.id == "tribute_brancato"]
    assert tribute and tribute[0].amount == 300
    assert state.rivalries["brancato"].stage == 0
    d = state.knowledge.decisions[-1]
    assert d.title == "Sit-down with The Brancato Family" and d.tone == "good" and d.trust_delta == 3


def test_empty_threats_and_walking_out_escalate(fresh):
    state, rng = fresh
    sit(state, rng)
    state.rivalries["brancato"].stage = 2
    state.families["brancato"].strength = 90
    apply(state, rng, SitDownAct(action="threaten"))
    assert state.sitdown is None  # a hothead's patience of 2 is gone
    assert state.rivalries["brancato"].stage == 3
    assert state.knowledge.decisions[-1].chosen == "No deal"


def test_a_credible_threat_brings_the_ask_down(fresh):
    state, rng = fresh
    sd = sit(state, rng)
    state.families["brancato"].strength = 10
    ask = sd.ask
    apply(state, rng, SitDownAct(action="threaten"))
    assert state.sitdown.ask == max(ask - tuned().sitdown.threat_drop, sd.red_line)


def test_holding_firm_works_on_a_broke_rival(fresh):
    state, rng = fresh
    state.families["brancato"].treasury = 1000
    sd = sit(state, rng)
    ask = sd.ask
    apply(state, rng, SitDownAct(action="hold"))
    assert state.sitdown.ask == max(ask - tuned().sitdown.hold_drop, sd.red_line)


def test_an_unfinished_sitdown_breaks_up_at_month_end(fresh):
    state, rng = fresh
    sit(state, rng)
    state.month += 1
    world.run(state, rng)
    assert state.sitdown is None
    assert "Nobody from the family came back" in state.knowledge.decisions[-1].text


def test_sitdown_commands_validate(fresh):
    state, rng = fresh
    with pytest.raises(CommandError):
        apply(state, rng, SitDownAct(action="concede"))
    sit(state, rng)
    with pytest.raises(CommandError):
        apply(state, rng, SitDownAct(action="shoot"))


# ---- saves ----

def test_version_4_save_upgrades(game):
    state, rng = game
    data = json.loads(to_json(state, rng))
    data["schema_version"] = 4
    for key in ("districts", "rivalries", "sitdown"):
        del data[key]
    del data["knowledge"]["investigations"]
    del data["knowledge"]["sitdown"]
    loaded, _ = from_json(json.dumps(data))
    assert loaded.rivalries == {} and loaded.sitdown is None
