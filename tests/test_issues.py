"""Primary issues: the month's main business, with conversations, facts and your case to the Don."""

import json

import pytest

from consigliere.cli import run
from consigliere.engine import matters
from consigliere.engine.commands import CommandError, Recommend, Talk, apply
from consigliere.engine.content import ContentError, check_talks, events
from consigliere.engine.eventdefs import EventDef
from consigliere.engine.rng import GameRNG
from consigliere.engine.state import from_json, to_json
from tests.helpers import tuned

PRIMARY = sorted(e.id for e in events().values() if e.primary)


@pytest.fixture
def fresh(game):
    state, rng = game
    state.matters = []
    state.event_log = {}
    return state, rng


def arise(state, rng, event_id, **secrets):
    """Put a primary issue on the desk, with chosen secrets."""
    event = events()[event_id]
    bindings = matters.bind(event, state, rng)
    for name, value in secrets.items():
        bindings["?" + name] = "yes" if value else "no"
    matter = matters.make_matter(event, bindings, state, rng)
    state.matters = [matter]
    return matter


def talk_index(matter, name):
    return next(i for i, t in enumerate(matter.talks) if t.name == name)


def say(state, rng, matter, who, text):
    """Say the line that starts with text, in the conversation with who."""
    i = talk_index(matter, who)
    line = next(k for k, l in enumerate(matter.talks[i].lines) if l.startswith(text))
    apply(state, rng, Talk(matter_id=matter.id, talk=i, line=line))


def test_there_are_a_dozen_primary_issues_each_with_the_don():
    assert len(PRIMARY) >= 12
    for event_id in PRIMARY:
        event = events()[event_id]
        assert any(t.with_ == "don" for t in event.talks)
        assert len(event.talks) >= 3


@pytest.mark.parametrize("event_id", PRIMARY)
def test_every_conversation_can_be_walked_to_the_end_without_loose_ends(event_id):
    for seed in range(8):
        from consigliere.engine.scenario import new_game
        state, rng = new_game(seed)
        state.month = 60
        event = events()[event_id]
        bindings = matters.bind(event, state, rng)
        matter = matters.make_matter(event, bindings, state, rng)
        state.matters = [matter]
        pick = GameRNG(seed)
        for _ in range(3):
            for i, conversation in enumerate(matter.talks):
                for _ in range(60):
                    if not conversation.lines:
                        break
                    apply(state, rng, Talk(matter_id=matter.id, talk=i, line=pick.randint(0, len(conversation.lines) - 1)))
                assert not conversation.lines
        texts = [matter.title, matter.text] + matter.facts + [o.label for o in matter.options]
        texts += [entry.text for t in matter.talks for entry in t.log] + [t.where for t in matter.talks]
        assert not [t for t in texts if "{" in t]


def test_what_one_man_tells_you_opens_a_line_with_the_don(fresh):
    state, rng = fresh
    m = arise(state, rng, "rival_proposal", setup=1, debt=1)
    don = talk_index(m, state.characters[state.player_family.don_id].name)
    assert not any(l.startswith("Their soldiers have been counting") for l in m.talks[don].lines)
    capo = state.characters[m.bindings["capo"]].name
    say(state, rng, m, capo, "Have your men seen anything")
    assert matters.knows(m, "measuring")
    assert any("counting doorways" in f for f in m.facts)
    assert any(l.startswith("Their soldiers have been counting") for l in m.talks[don].lines)


def test_the_truth_decides_what_you_can_learn(fresh):
    state, rng = fresh
    m = arise(state, rng, "rival_proposal", setup=0, debt=0)
    capo = state.characters[m.bindings["capo"]].name
    say(state, rng, m, capo, "Have your men seen anything")
    assert matters.knows(m, "quiet") and not matters.knows(m, "measuring")


def test_options_that_need_facts_are_locked_until_you_know_them(fresh):
    state, rng = fresh
    m = arise(state, rng, "rival_proposal", setup=1, debt=1)
    with pytest.raises(CommandError):
        apply(state, rng, Recommend(matter_id=m.id, choice="trap"))
    say(state, rng, m, state.characters[m.bindings["capo"]].name, "Have your men seen anything")
    apply(state, rng, Recommend(matter_id=m.id, choice="trap"))
    assert m.recommendation == "trap"


def test_the_don_never_chooses_what_you_never_learned(fresh):
    state, rng = fresh
    m = arise(state, rng, "rival_proposal", setup=1, debt=1)
    event = events()["rival_proposal"]
    don = state.characters[state.player_family.don_id]
    picks = {matters.don_preference(event, don, GameRNG(s), tuned(advice={"don_noise": 5.0}), m) for s in range(200)}
    assert picks <= {"accept", "refuse"}


def test_every_line_is_said_once_and_a_hub_offers_what_is_left(fresh):
    state, rng = fresh
    m = arise(state, rng, "rival_proposal", setup=0, debt=0)
    boss = state.characters[m.bindings["boss"]].name
    i = talk_index(m, boss)
    assert len(m.talks[i].lines) == 3
    say(state, rng, m, boss, "Why now?")
    assert [l[:12] for l in m.talks[i].lines] == ["Thirty is lo", "I'll put it "]
    say(state, rng, m, boss, "Thirty is low")
    say(state, rng, m, boss, "I'll put it to the Don")
    assert m.talks[i].node is None and not m.talks[i].lines
    with pytest.raises(CommandError):
        apply(state, rng, Talk(matter_id=m.id, talk=i, line=0))


def test_a_conversation_waiting_on_facts_stays_open(fresh):
    state, rng = fresh
    m = arise(state, rng, "restaurant_debt", lien=1, gambling=1)
    don = talk_index(m, state.characters[state.player_family.don_id].name)
    assert m.talks[don].node == "start" and m.talks[don].lines == []
    say(state, rng, m, "Gino Bastiani", "How did you get so deep")
    assert m.talks[don].lines and m.talks[don].node == "start"


def test_your_case_is_what_you_argued_for_less_what_you_argued_against(fresh):
    state, rng = fresh
    m = arise(state, rng, "rival_proposal")
    m.case = {"trap": 0.2, "refuse": 0.1, "accept": -0.1}
    assert matters.case_for(m, "trap") == pytest.approx(0.1)
    assert matters.case_for(m, "accept") == pytest.approx(-0.4)
    m.case = {"trap": 0.3}
    assert matters.case_for(m, "trap") == pytest.approx(0.3)


@pytest.mark.parametrize("argued_for_it", [True, False])
def test_a_good_case_moves_the_don(fresh, argued_for_it):
    state, rng = fresh
    m = arise(state, rng, "rival_proposal")
    bal = tuned(advice={"follow_base": 0.5, "follow_trust_weight": 0.0, "follow_mood_weight": 0.0,
                        "follow_traits": {}, "follow_min": 0.0, "follow_max": 1.0, "don_noise": 0.0})
    don = state.characters[state.player_family.don_id]
    own = matters.don_preference(events()["rival_proposal"], don, GameRNG(0), bal, m)
    rec = next(o.id for o in m.options if o.id != own and matters.option_open(m, o))
    m.recommendation = rec
    m.case = {rec: 1.0} if argued_for_it else {own: 1.0}
    matters.resolve(state, m, rng, bal, events())
    chosen = state.knowledge.decisions[-1].chosen
    assert chosen == matters.label_of(m, rec if argued_for_it else own)


def test_one_primary_issue_a_month_and_it_comes_first(fresh):
    state, rng = fresh
    state.month = 30
    matters.begin_month(state, rng)
    primaries = [m for m in state.matters if m.primary]
    assert len(primaries) == 1 and state.matters[0].primary
    matters.begin_month(state, rng)
    assert len([m for m in state.matters if m.primary]) == 1


def test_month_zero_opens_with_the_restaurant(game):
    state, _ = game
    assert state.matters[0].primary and state.matters[0].event_id == "restaurant_debt"


def bad_issue(**changes):
    base = {
        "id": "x", "title": "X", "text": "X", "primary": True, "facts": {"f": "F"},
        "talks": [{"with": "don", "nodes": {"start": {"says": "Hm.", "lines": [{"say": "Ask", "to": "a"}]},
                                              "a": {"says": "Yes.", "learn": ["f"]}}}],
        "options": [{"id": "o1", "label": "One", "outcomes": [{"tone": "neutral", "text": "."}]},
                    {"id": "o2", "label": "Two", "needs": ["f"], "outcomes": [{"tone": "neutral", "text": "."}]}],
    }
    base.update(changes)
    return EventDef.model_validate(base)


def test_a_sound_issue_passes_its_checks():
    check_talks(bad_issue())


@pytest.mark.parametrize("change, message", [
    ({"facts": {"f": "F", "g": "G"}}, "facts nobody can teach"),
    ({"talks": [{"with": "don", "nodes": {"start": {"says": "Hm.", "lines": [{"say": "Ask", "to": "nowhere"}]}}}]}, "unknown node"),
    ({"talks": [{"with": "don", "nodes": {"start": {"says": "Hm.", "lines": [{"say": "Ask", "learn": ["f"]}]},
                                          "lost": {"says": "?"}}}]}, "never reaches"),
    ({"talks": [{"with": "don", "nodes": {"start": {"says": "Hm.", "lines": [{"say": "Ask", "learn": ["f"], "case": {"o9": 0.1}}]}}}]}, "unknown option"),
    ({"talks": [{"with": "don", "nodes": {"start": {"says": "Hm.", "lines": [{"say": "Ask", "learn": ["f"], "when": [["knows.g", "==", 1]]}]}}}]}, "unknown fact"),
])
def test_broken_issues_are_caught_at_load(change, message):
    with pytest.raises(ContentError, match=message):
        check_talks(bad_issue(**change))


def test_shape_rules_for_primary_issues():
    with pytest.raises(ValueError, match="talk with the Don"):
        bad_issue(talks=[{"with": "other", "name": "Nunzio", "nodes": {"start": {"says": "Hm."}}}])
    with pytest.raises(ValueError, match="needs no facts"):
        bad_issue(options=[{"id": "o2", "label": "Two", "needs": ["f"], "outcomes": [{"tone": "neutral", "text": "."}]},
                           {"id": "o3", "label": "Three", "needs": ["f"], "outcomes": [{"tone": "neutral", "text": "."}]}])
    with pytest.raises(ValueError, match="cannot teach"):
        bad_issue(talks=[{"with": "don", "nodes": {"start": {"says": "Hm.", "learn": ["f"]}}}])


def test_names_read_right_mid_sentence():
    assert matters.put_name("{r} owns it.", "{r}", "The Brancato Family") == "The Brancato Family owns it."
    assert matters.put_name("games {r} runs", "{r}", "The Brancato Family") == "games the Brancato Family runs"
    assert matters.put_name('said, "{r} did."', "{r}", "The Brancato Family") == 'said, "The Brancato Family did."'
    assert matters.put_name("ask {r}", "{r}", "Vito Amaro") == "ask Vito Amaro"


def test_a_conversation_survives_a_save(fresh):
    state, rng = fresh
    m = arise(state, rng, "rival_proposal", setup=1)
    say(state, rng, m, state.characters[m.bindings["capo"]].name, "Have your men seen anything")
    loaded, _ = from_json(to_json(state, rng))
    again = loaded.matters[0]
    assert again.facts == m.facts and again.talks == m.talks and matters.knows(again, "measuring")


def test_version_8_save_upgrades(game):
    state, rng = game
    data = json.loads(to_json(state, rng))
    data["schema_version"] = 8
    for matter in data["matters"]:
        for key in ("primary", "facts", "talks", "case"):
            del matter[key]
        for option in matter["options"]:
            del option["needs"]
    loaded, _ = from_json(json.dumps(data))
    assert all(not m.primary and m.talks == [] for m in loaded.matters)


def scripted(lines):
    it = iter(lines)
    return lambda prompt="": next(it)


def test_the_text_game_can_talk(game):
    state, rng = game
    out = []
    run(state, rng, scripted(["d", "t 1 1", "t 1 1 1", "t 9 9", "q"]), out.append)
    text = "\n".join(out)
    assert "People to see" in text and "Gino Bastiani" in text
    assert "You: " in text
    assert "Usage: t <matter number> <person number> [line number]" in text
