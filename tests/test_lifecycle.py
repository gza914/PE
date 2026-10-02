import json

import pytest

from consigliere.engine import lifecycle, matters
from consigliere.engine.commands import CommandError, EndMonth, Recommend, apply
from consigliere.engine.content import events
from consigliere.engine.rng import GameRNG
from consigliere.engine.state import from_json, to_json
from consigliere.engine.turn import tick
from tests.helpers import tuned


@pytest.fixture
def fresh(game):
    state, rng = game
    state.matters = []
    state.event_log = {}
    return state, rng


# ---- aging and death ----

def test_the_old_decline_and_the_young_do_not(fresh):
    state, rng = fresh
    state.month = 12 * 10  # 1968
    bal = tuned()
    don, nicky = state.characters["don_ferrante"], state.characters["nicky_brancato"]
    for _ in range(24):
        lifecycle.run_aging(state, rng, bal)
    assert don.hidden.health < 80
    assert nicky.hidden.health == 95


def test_death_removes_a_man_and_schedules_his_funeral(fresh):
    state, rng = fresh
    amaro = state.characters["capo_amaro"]
    amaro.hidden.health = 1
    lifecycle.run_aging(state, rng, tuned(life={"age_rate": 1.0, "decline_min": 3, "decline_max": 3}))
    assert not amaro.alive and amaro.fate == "died"
    assert state.scheduled[-1].event_id == "funeral"
    assert state.rackets["numbers_eastside"].capo_id is None


def test_the_dons_death_opens_the_succession(fresh):
    state, rng = fresh
    don = state.characters["don_ferrante"]
    don.hidden.health = 1
    lifecycle.run_aging(state, rng, tuned(life={"age_rate": 1.0, "decline_min": 3, "decline_max": 3}))
    assert "don_gone" in state.flags
    matters.begin_month(state, rng)
    [m] = [m for m in state.matters if m.event_id == "succession"]
    assert len(m.intel) == 3 and not m.can_wait


def test_a_rival_heir_takes_over(fresh):
    state, _ = fresh
    state.characters["don_orsini"].alive = False
    lifecycle.run_rival_heirs(state)
    assert state.families["orsini"].don_id == "paolo_orsini"
    assert state.characters["paolo_orsini"].role.value == "rival_boss"
    assert state.scheduled[-1].event_id == "new_rival_boss"


# ---- succession ----

CANDIDATES = ["capo_amaro", "capo_tessaro", "underboss_lauro"]


def succeed(state, backed, **sb):
    return lifecycle.install_successor(state, GameRNG(0), CANDIDATES, backed, tuned(succession=sb) if sb else tuned())


def test_a_winner_you_backed_owes_you(fresh):
    state, _ = fresh
    state.characters["don_ferrante"].alive = False
    winner = succeed(state, "capo_tessaro", backing_bonus=10_000)
    assert winner == "capo_tessaro"
    assert state.player_family.don_id == "capo_tessaro"
    assert state.characters["capo_tessaro"].role.value == "don"
    assert all(r.capo_id != "capo_tessaro" for r in state.rackets.values())
    assert state.standing.dons_trust == 70
    assert state.knowledge.dons == ["Aurelio Ferrante", "Frank Tessaro"]
    assert "don_gone" not in state.flags


def test_staying_out_is_safe_but_cool(fresh):
    state, _ = fresh
    succeed(state, None)
    assert state.standing.dons_trust == 45


@pytest.mark.parametrize("keep, pushed", [(1.0, False), (0.0, True)])
def test_backing_the_loser_can_cost_you_the_job(fresh, keep, pushed):
    state, _ = fresh
    for cid in ("capo_tessaro", "underboss_lauro"):
        state.characters[cid].stats.respect = 100
    state.characters["capo_amaro"].stats.respect = 0
    state.characters["capo_amaro"].stats.loyalty = 0
    state.standing.influence = 0
    winner = succeed(state, "capo_amaro", backing_bonus=0, keep_base=keep, keep_influence=0)
    assert winner != "capo_amaro"
    assert ("pushed_out" in state.flags) == pushed


def test_succession_matter_is_yours_alone(fresh):
    state, rng = fresh
    state.flags["don_gone"] = 0
    state.characters["don_ferrante"].alive = False
    e = events()["succession"]
    m = matters.make_matter(e, matters.bind(e, state, rng), state, rng)
    state.matters = [m]
    m.recommendation = "back_a"
    for slot in ("a", "b", "c"):
        man = state.characters[m.bindings[slot]]
        man.stats.respect = man.stats.loyalty = 100 if slot == "a" else 0
    matters.run(state, rng)
    d = state.knowledge.decisions[-1]
    winner = state.characters[m.bindings["a"]]
    assert d.followed is None and d.trust_delta == 0
    assert winner.name in d.text and state.player_family.don_id == winner.id


def test_saying_nothing_on_your_own_decision_takes_the_default(fresh):
    state, rng = fresh
    e = events()["retirement_offer"]
    m = matters.make_matter(e, {}, state, rng)
    state.matters = [m]
    matters.run(state, rng)
    assert state.knowledge.decisions[-1].chosen == "Not yet"
    assert "retire" not in state.flags


# ---- endings ----

@pytest.mark.parametrize("setup, ending", [
    (lambda s: s.flags.update(you_jailed=0), "prison"),
    (lambda s: setattr(s.standing, "dons_trust", 0), "disposed"),
    (lambda s: setattr(s.standing, "exposure", 100), "exile"),
    (lambda s: setattr(s.player_family, "strength", 3), "ruin"),
    (lambda s: s.flags.update(pushed_out=0), "pushed_out"),
    (lambda s: s.flags.update(retire=0), "retired_intact"),
    (lambda s: setattr(s, "month", 179), "era_intact"),
])
def test_endings(fresh, setup, ending):
    state, _ = fresh
    setup(state)
    assert lifecycle.which_ending(state, tuned()) == ending


def test_dying_ends_it(fresh):
    state, _ = fresh
    from consigliere.engine.world import remove_from_play
    remove_from_play(state, state.player, "died")
    assert lifecycle.which_ending(state, tuned()) == "died"
    state.player.fate = "killed"
    assert lifecycle.which_ending(state, tuned()) == "killed"


def test_a_poor_retirement_is_a_lesser_one(fresh):
    state, _ = fresh
    state.flags["retire"] = 0
    state.player_family.treasury = -1
    assert lifecycle.which_ending(state, tuned()) == "retired_diminished"


def test_the_story_ends_with_a_memoir_and_stops(game):
    state, rng = game
    for _ in range(3):
        apply(state, rng, EndMonth())
    state.flags["retire"] = state.month
    month = state.month
    tick(state, rng)
    ending = state.ending
    assert ending.id == "retired_intact" and ending.rank == 1
    assert "Thomas Corvo" in ending.text and "{" not in ending.text
    assert ending.memoir.months == month + 1
    assert ending.memoir.dons == ["Aurelio Ferrante"]
    assert ending.memoir.matters == len([d for d in state.knowledge.decisions if d.tone != "waiting"])
    assert state.month == month
    tick(state, rng)
    assert state.month == month
    with pytest.raises(CommandError):
        apply(state, rng, EndMonth())
    with pytest.raises(CommandError):
        apply(state, rng, Recommend(matter_id="x", choice=None))


def test_ruin_when_nobody_is_left_to_lead(fresh):
    state, _ = fresh
    state.flags["don_gone"] = 0
    for m in matters.crew(state):
        m.alive = False
    assert lifecycle.crew_size(state) == 0
    assert lifecycle.which_ending(state, tuned()) == "ruin"


def test_version_5_save_upgrades(game):
    state, rng = game
    data = json.loads(to_json(state, rng))
    data["schema_version"] = 5
    del data["ending"]
    del data["knowledge"]["dons"]
    loaded, _ = from_json(json.dumps(data))
    assert loaded.ending is None and loaded.knowledge.dons == ["Aurelio Ferrante"]


def test_recruiting_a_new_capo(fresh):
    state, rng = fresh
    before = lifecycle.crew_size(state)
    man_id = lifecycle.recruit(state, rng, "earner")
    man = state.characters[man_id]
    assert man.role.value == "capo" and man.family_id == "ferrante" and man.alive
    assert {"ambitious", "greedy"} <= {t.value for t in man.traits} and len(man.traits) == 3
    assert 65 <= man.stats.competence <= 85
    assert 28 <= 1958 - man.hidden.birth_year <= 42
    assert man_id in state.knowledge.impressions
    assert lifecycle.crew_size(state) == before + 1
    names = {c.name for c in state.characters.values()}
    assert len(names) == len(state.characters)


def test_an_empty_chair_gets_filled(fresh):
    state, rng = fresh
    for cid in ("capo_amaro", "capo_tessaro"):
        state.characters[cid].alive = False
    e = events()["new_capo"]
    assert matters.check_all(state, {}, e.trigger)
    m = matters.make_matter(e, {}, state, rng)
    state.matters = [m]
    m.recommendation = "steady"
    matters.run(state, rng, tuned(advice={"follow_min": 1.0, "follow_max": 1.0}))
    d = state.knowledge.decisions[-1]
    assert "{" not in d.text and lifecycle.crew_size(state) == 4


def test_a_family_down_to_two_men_still_chooses(fresh):
    state, rng = fresh
    for cid in ("capo_amaro", "capo_tessaro", "capo_marchetti"):
        state.characters[cid].alive = False
    state.characters["don_ferrante"].alive = False
    state.flags["don_gone"] = 0
    matters.begin_month(state, rng)
    [m] = [m for m in state.matters if m.event_id == "succession_pair"]
    assert not any(x.event_id == "succession" for x in state.matters)
    m.recommendation = "stay_out"
    matters.run(state, rng)
    assert state.player_family.don_id in (m.bindings["a"], m.bindings["b"])
