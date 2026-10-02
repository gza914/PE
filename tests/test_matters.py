import pytest

from consigliere.engine import matters
from consigliere.engine.commands import CommandError, EndMonth, Recommend, apply
from consigliere.engine.content import ContentError, check_event_references, events
from consigliere.engine.eventdefs import Effect, EventDef
from consigliere.engine.models import LedgerEntry, Scheduled
from consigliere.engine.rng import GameRNG
from tests.helpers import tuned

ALWAYS_FOLLOWS = tuned(advice={"follow_min": 1.0, "follow_max": 1.0, "don_noise": 0.0})
NEVER_FOLLOWS = tuned(advice={"follow_min": 0.0, "follow_max": 0.0, "don_noise": 0.0})


def outcome(tone="good", text="It happens.", effects=(), weight=1.0, **extra):
    return {"tone": tone, "text": text, "effects": list(effects), "weight": weight, **extra}


def option(oid, *outcomes, don=None, **extra):
    return {"id": oid, "label": oid.title(), "don": don or {}, "outcomes": list(outcomes) or [outcome()], **extra}


def event(eid="test", options=None, **extra):
    data = {"id": eid, "title": "About {capo}", "text": "{capo} and {don}.",
            "cast": {"capo": {"role": ["capo"]}}, "options": options or [option("yes"), option("no")]}
    data.update(extra)
    return EventDef.model_validate(data)


def evs(*defs):
    return {d.id: d for d in defs}


def fx(**effect):
    return Effect.model_validate(effect)


@pytest.fixture
def fresh(game):
    """The default game with its first month's matters cleared."""
    state, rng = game
    state.matters = []
    state.event_log = {}
    return state, rng


# ---- conditions ----

def test_lookup_globals_and_bindings(fresh):
    state, _ = fresh
    b = {"capo": "capo_tessaro", "racket": "docks_pier_9"}
    assert matters.lookup(state, b, "treasury") == state.player_family.treasury
    assert matters.lookup(state, b, "capo.greed") == 75
    assert matters.lookup(state, b, "capo.age") == 1958 - 1921
    assert matters.lookup(state, b, "capo.rackets") == 2
    assert matters.lookup(state, b, "racket.kind") == "docks"
    assert matters.lookup(state, b, "flag.anything") == 0
    assert matters.lookup(state, b, "construction") == "construction"
    with pytest.raises(ContentError):
        matters.lookup(state, b, "capo.shoe_size")


def test_has_and_lacks_cover_traits_and_vices(fresh):
    state, _ = fresh
    b = {"capo": "capo_sabella"}
    assert matters.check(state, b, ["capo", "has", "hothead"])
    assert matters.check(state, b, ["capo", "has", "cards"])
    assert matters.check(state, b, ["capo", "lacks", "loyal"])
    assert matters.check(state, b, ["capo.loyalty", "<", "capo.fear"])


# ---- casting ----

def test_bind_respects_role_where_and_distinct(fresh):
    state, _ = fresh
    e = event(cast={
        "capo": {"role": ["capo"], "where": [["self", "has", "ambitious"]]},
        "rival": {"role": ["capo"], "where": [["self.rackets", ">=", 2]]},
        "racket": {"racket_of": "rival"},
    })
    b = matters.bind(e, state, GameRNG(0))
    assert b["capo"] == "capo_tessaro"
    assert b["rival"] == "capo_sabella"  # Tessaro has 2 rackets too, but he is taken
    assert state.rackets[b["racket"]].capo_id == "capo_sabella"


def test_bind_runs_picks_the_racket_owner(fresh):
    state, _ = fresh
    e = event(cast={"racket": {"racket": True, "where": [["self.kind", "==", "numbers"]]},
                    "capo": {"role": ["capo"], "runs": "racket"}})
    assert matters.bind(e, state, GameRNG(0)) == {"racket": "numbers_eastside", "capo": "capo_amaro"}


def test_bind_fails_without_candidates(fresh):
    state, _ = fresh
    e = event(cast={"capo": {"role": ["capo"], "where": [["self.loyalty", ">", 100]]}})
    assert matters.bind(e, state, GameRNG(0)) is None


def test_fill_names(fresh):
    state, _ = fresh
    text = matters.fill("{capo} runs {racket} for {don}; {you} of {family}.", state,
                        {"capo": "capo_amaro", "racket": "numbers_eastside"})
    assert text == "Vito Amaro runs Eastside numbers for Aurelio Ferrante; Thomas Corvo of The Ferrante Family."


# ---- effects ----

def apply_fx(state, effect, bindings=None, rng=None):
    matters.apply_effect(state, effect, bindings or {"capo": "capo_amaro", "racket": "numbers_eastside"},
                         rng or GameRNG(0), event(), "Test")


def test_stat_effects_clamp_and_reach_the_crew(fresh):
    state, _ = fresh
    apply_fx(state, fx(stat={"who": "capo", "stat": "loyalty", "delta": 50}))
    assert state.characters["capo_amaro"].stats.loyalty == 100
    before = {c.id: c.stats.fear for c in matters.crew(state)}
    apply_fx(state, fx(stat={"who": "crew", "stat": "fear", "delta": 1}))
    assert all(c.stats.fear == before[c.id] + 1 for c in matters.crew(state))
    assert "don_ferrante" not in before and "you" not in before


def test_memory_effect_resolves_about(fresh):
    state, _ = fresh
    apply_fx(state, fx(memory={"who": "capo", "about": "family", "weight": -5}))
    apply_fx(state, fx(memory={"who": "capo", "about": "don", "weight": 3, "decay": 0.01}))
    mems = state.characters["capo_amaro"].memory
    assert [(m.about_id, m.weight, m.event_id) for m in mems] == [("ferrante", -5, "test"), ("don_ferrante", 3, "test")]


def test_treasury_effect_is_booked(fresh):
    state, _ = fresh
    family = state.player_family
    state.knowledge.ledger.append(LedgerEntry(month=state.month, treasury_start=family.treasury, treasury_end=family.treasury))
    apply_fx(state, fx(treasury=-2500))
    entry = state.knowledge.ledger[-1]
    assert [(line.label, line.amount) for line in entry.other] == [("Test", -2500)]
    assert entry.treasury_end == family.treasury == 37500


def test_money_before_the_books_open_lands_in_next_months_books(fresh):
    state, rng = fresh
    apply_fx(state, fx(treasury=1000))
    assert state.unbooked and state.player_family.treasury == 41000
    from consigliere.engine.systems import economy
    economy.run(state, rng)
    entry = state.knowledge.ledger[-1]
    assert [line.amount for line in entry.other] == [1000]
    assert entry.treasury_start == 40000
    assert entry.treasury_end == entry.treasury_start + entry.total_in - entry.total_out + 1000
    assert state.unbooked == []


def test_racket_and_expense_effects(fresh):
    state, _ = fresh
    apply_fx(state, fx(racket_income={"racket": "racket", "pct": 15}))
    assert state.rackets["numbers_eastside"].income == 8050
    apply_fx(state, fx(assign_racket={"racket": "racket", "to": None}))
    assert state.rackets["numbers_eastside"].capo_id is None
    apply_fx(state, fx(add_expense={"id": "x", "label": "X", "amount": 100}))
    apply_fx(state, fx(add_expense={"id": "x", "label": "X", "amount": 999}))
    apply_fx(state, fx(change_expense={"id": "x", "delta": -500}))
    assert [(e.id, e.amount) for e in state.player_family.expenses if e.id == "x"] == [("x", 0)]
    apply_fx(state, fx(remove_expense="x"))
    assert all(e.id != "x" for e in state.player_family.expenses)


def test_flags_and_followups(fresh):
    state, _ = fresh
    apply_fx(state, fx(flag="promised"))
    assert matters.lookup(state, {}, "flag.promised") == 1
    apply_fx(state, fx(clear_flag="promised"))
    assert "promised" not in state.flags
    apply_fx(state, fx(followup={"event": "territory_sulk", "after": [2, 4], "when": [["capo.loyalty", "<", 50]]}))
    [item] = state.scheduled
    assert 2 <= item.month - state.month <= 4
    assert item.bindings["capo"] == "capo_amaro"


# ---- arising ----

def test_matters_arise_with_cooldown_once_and_no_duplicates(fresh):
    state, rng = fresh
    bal = tuned(matters={"per_month_min": 3, "per_month_max": 3})
    once = event("once_only", once=True)
    cooled = event("cooled", cooldown=5)
    hidden = event("hidden", followup_only=True)
    gated = event("gated", trigger=[["treasury", ">", 10**9]])
    pool = evs(once, cooled, hidden, gated)
    matters.begin_month(state, rng, bal, pool)
    assert sorted(m.event_id for m in state.matters) == ["cooled", "once_only"]
    matters.begin_month(state, rng, bal, pool)
    assert len(state.matters) == 2  # still pending: no duplicates
    state.matters = []
    state.month += 3
    matters.begin_month(state, rng, bal, pool)
    assert state.matters == []  # once has fired; cooled is cooling down
    state.month += 2
    matters.begin_month(state, rng, bal, pool)
    assert [m.event_id for m in state.matters] == ["cooled"]


def test_matter_text_is_filled(fresh):
    state, rng = fresh
    matters.begin_month(state, rng, tuned(matters={"per_month_min": 1, "per_month_max": 1}), evs(event()))
    [m] = state.matters
    name = state.characters[m.bindings["capo"]].name
    assert m.title == f"About {name}" and m.text == f"{name} and Aurelio Ferrante."
    assert [o.label for o in m.options] == ["Yes", "No"]


def test_scheduled_news_applies_and_is_reported(fresh):
    state, rng = fresh
    state.scheduled.append(Scheduled(event_id="territory_sulk", month=state.month, bindings={"capo": "capo_tessaro"}))
    before = state.characters["capo_tessaro"].stats.loyalty
    matters.run_scheduled(state, rng, events())
    assert state.characters["capo_tessaro"].stats.loyalty == before - 5
    assert state.knowledge.news[-1].title == "Frank Tessaro keeps his own company"
    assert state.scheduled == []


def test_scheduled_followup_dropped_when_condition_fails(fresh):
    state, rng = fresh
    state.scheduled.append(Scheduled(event_id="territory_sulk", month=state.month, bindings={"capo": "capo_amaro"},
                                     when=[["capo.loyalty", "<", 50]]))
    matters.run_scheduled(state, rng, events())
    assert state.knowledge.news == [] and state.scheduled == []


def test_scheduled_matter_reaches_the_desk(fresh):
    state, rng = fresh
    state.flags["promised_territory"] = 0
    b = {"capo": "capo_tessaro", "rival": "capo_sabella", "racket": "docks_pier_9"}
    state.scheduled.append(Scheduled(event_id="promise_comes_due", month=state.month, bindings=b))
    matters.run_scheduled(state, rng, events())
    [m] = state.matters
    assert m.title == "Frank Tessaro remembers a promise" and not m.can_wait


# ---- the Don decides ----

def desk(state, e, recommendation):
    m = matters.make_matter(e, {"capo": "capo_amaro"}, state, GameRNG(0))
    m.recommendation = recommendation
    state.matters = [m]
    return m


def settle(state, rng, bal, e):
    matters.run(state, rng, bal, evs(e))
    return state.knowledge.decisions[-1]


def test_followed_advice_good_outcome_raises_trust(fresh):
    state, rng = fresh
    e = event(options=[option("yes", outcome("good"), advised_exposure=3), option("no", outcome("bad"), don={"base": 5})])
    desk(state, e, "yes")
    d = settle(state, rng, ALWAYS_FOLLOWS, e)
    assert (d.chosen, d.followed, d.tone, d.trust_delta) == ("Yes", True, "good", 3)
    assert state.standing.dons_trust == 53
    assert state.standing.exposure == 5 + 3
    assert state.matters == []


def test_ignored_advice_bad_outcome_still_costs(fresh):
    state, rng = fresh
    e = event(options=[option("yes", outcome("good"), advised_exposure=3), option("no", outcome("bad"), don={"base": 5})])
    desk(state, e, "yes")
    d = settle(state, rng, NEVER_FOLLOWS, e)
    assert (d.chosen, d.followed, d.tone, d.trust_delta) == ("No", False, "bad", -2)
    assert state.standing.exposure == 5  # your name is not on what he did instead


def test_bad_call_followed_costs_most(fresh):
    state, rng = fresh
    e = event(options=[option("yes", outcome("bad")), option("no", outcome("good"))])
    desk(state, e, "yes")
    assert settle(state, rng, ALWAYS_FOLLOWS, e).trust_delta == -8


def test_silence_on_a_matter_is_safe_but_a_silent_month_is_not(fresh):
    state, rng = fresh
    e = event(options=[option("yes", outcome("bad")), option("no", outcome("bad"))])
    desk(state, e, None)
    d = settle(state, rng, ALWAYS_FOLLOWS, e)
    assert d.followed is None and d.recommended is None and d.trust_delta == 0
    assert state.standing.dons_trust == 50 - ALWAYS_FOLLOWS.advice.silence_penalty


def test_advising_on_one_matter_is_enough(fresh):
    state, rng = fresh
    quiet = event("quiet", options=[option("yes", outcome("neutral")), option("no", outcome("neutral"))])
    spoken = event("spoken", options=[option("yes", outcome("neutral")), option("no", outcome("neutral"))])
    a = matters.make_matter(quiet, {"capo": "capo_amaro"}, state, GameRNG(0))
    b = matters.make_matter(spoken, {"capo": "capo_amaro"}, state, GameRNG(0))
    b.recommendation = "yes"
    state.matters = [a, b]
    matters.run(state, rng, ALWAYS_FOLLOWS, evs(quiet, spoken))
    assert state.standing.dons_trust == 50


def test_don_prefers_what_suits_his_traits(fresh):
    state, rng = fresh
    e = event(options=[option("bold", don={"base": 1}), option("careful", don={"cautious": 2})])
    assert matters.don_preference(e, state.characters["don_ferrante"], rng, NEVER_FOLLOWS) == "careful"


def test_agreeing_by_coincidence_counts_as_followed(fresh):
    state, rng = fresh
    e = event(options=[option("yes", outcome("good"), don={"base": 5}), option("no")])
    desk(state, e, "yes")
    d = settle(state, rng, NEVER_FOLLOWS, e)
    assert d.followed is True and d.trust_delta == 3


def test_waiting_keeps_the_matter_until_patience_runs_out(fresh):
    state, rng = fresh
    e = event(patience=1)
    m = desk(state, e, "wait")
    d = settle(state, rng, ALWAYS_FOLLOWS, e)
    assert d.tone == "waiting" and state.matters == [m]
    assert m.waited == 1 and not m.can_wait and m.recommendation is None
    m.recommendation = "wait"  # no longer allowed: treated as silence
    d = settle(state, rng, ALWAYS_FOLLOWS, e)
    assert d.followed is None and state.matters == []


def test_follow_chance_tracks_trust_and_mood(fresh):
    state, _ = fresh
    don = state.characters["don_ferrante"]
    low = matters.follow_chance(state, don, tuned())
    state.standing.dons_trust, state.don_mood = 90, 80
    high = matters.follow_chance(state, don, tuned())
    assert low < high <= tuned().advice.follow_max


def test_mood_drifts_back_to_even(fresh):
    state, rng = fresh
    state.don_mood = 10
    for _ in range(60):
        matters.run(state, rng, tuned(), {})
    assert 45 <= state.don_mood <= 55


# ---- commands and the full loop ----

def test_recommend_validates(game):
    state, rng = game
    m = state.matters[0]
    apply(state, rng, Recommend(matter_id=m.id, choice=m.options[0].id))
    assert m.recommendation == m.options[0].id
    apply(state, rng, Recommend(matter_id=m.id, choice=None))
    assert m.recommendation is None
    with pytest.raises(CommandError):
        apply(state, rng, Recommend(matter_id=m.id, choice="burn_it_down"))
    with pytest.raises(CommandError):
        apply(state, rng, Recommend(matter_id="nope", choice=None))


def test_new_game_starts_with_matters_and_end_month_settles_them(game):
    state, rng = game
    assert 1 <= len(state.matters) <= 3
    first = [m.id for m in state.matters]
    apply(state, rng, EndMonth())
    assert {d.matter_id for d in state.knowledge.decisions} == set(first)
    assert all(m.month == 1 for m in state.matters)


def test_content_references_are_checked():
    bad = event("bad", options=[option("yes", outcome(effects=[{"stat": {"who": "ghost", "stat": "fear", "delta": 1}}])),
                                option("no")])
    with pytest.raises(ContentError):
        check_event_references(evs(bad))
    with pytest.raises(ContentError):
        check_event_references(evs(event("f", options=[
            option("yes", outcome(effects=[{"followup": {"event": "missing", "after": [1, 2]}}])), option("no")])))
