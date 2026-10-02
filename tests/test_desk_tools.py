import json

import pytest

from consigliere.engine import matters
from consigliere.engine.commands import CommandError, EndMonth, FlagBooks, Note, Pin, ProposeReassign, apply
from consigliere.engine.state import from_json, to_json
from tests.helpers import tuned


@pytest.fixture
def fresh(game):
    state, rng = game
    state.matters = []
    return state, rng


def test_notes_and_pins(fresh):
    state, rng = fresh
    apply(state, rng, Note(character_id="capo_tessaro", text="  Watch the garment loans.  "))
    assert state.knowledge.notes["capo_tessaro"] == "Watch the garment loans."
    apply(state, rng, Note(character_id="capo_tessaro", text="x" * 900))
    assert len(state.knowledge.notes["capo_tessaro"]) == 500
    apply(state, rng, Note(character_id="capo_tessaro", text=""))
    assert "capo_tessaro" not in state.knowledge.notes
    apply(state, rng, Pin(character_id="capo_amaro", pinned=True))
    apply(state, rng, Pin(character_id="capo_sabella", pinned=True))
    apply(state, rng, Pin(character_id="capo_amaro", pinned=False))
    assert state.knowledge.pinned == ["capo_sabella"]
    with pytest.raises(CommandError):
        apply(state, rng, Note(character_id="nobody", text="?"))


def test_flagging_the_books_puts_a_matter_on_the_desk(fresh):
    state, rng = fresh
    apply(state, rng, FlagBooks(capo_id="capo_tessaro"))
    [m] = state.matters
    assert m.event_id == "flagged_books" and m.title == "The numbers on Frank Tessaro"
    assert m.intel and m.intel[0].about == "capo_tessaro"
    assert state.knowledge.flagged["capo_tessaro"] == state.month
    with pytest.raises(CommandError):
        apply(state, rng, FlagBooks(capo_id="capo_tessaro"))  # already on the desk
    for bad in ("you", "don_ferrante", "don_brancato", "underboss_lauro"):
        assert not matters.can_flag(state, bad)


def test_flag_cooldown(fresh):
    state, rng = fresh
    state.knowledge.flagged["capo_amaro"] = state.month
    assert not matters.can_flag(state, "capo_amaro")
    state.month += 6
    assert matters.can_flag(state, "capo_amaro")


def test_auditing_a_skimmer_pays(fresh):
    state, rng = fresh
    state.characters["capo_tessaro"].hidden.stash = 20000
    apply(state, rng, FlagBooks(capo_id="capo_tessaro"))
    state.matters[0].recommendation = "audit"
    before = state.player_family.treasury
    matters.run(state, rng, tuned(advice={"follow_min": 1.0, "follow_max": 1.0}))
    assert state.knowledge.decisions[-1].tone == "good"
    assert state.player_family.treasury == before + 5000


def test_proposing_a_move(fresh):
    state, rng = fresh
    apply(state, rng, ProposeReassign(racket_id="docks_pier_9", capo_id="capo_marchetti"))
    [m] = state.matters
    assert m.event_id == "reassignment" and m.recommendation == "move"
    assert m.title == "Pier 9: from Augie Sabella to Leo Marchetti"
    with pytest.raises(CommandError):
        apply(state, rng, ProposeReassign(racket_id="docks_pier_9", capo_id="capo_amaro"))  # one at a time
    for racket, capo in (("docks_pier_9", "capo_sabella"), ("numbers_river", "capo_amaro"), ("docks_pier_9", "you")):
        assert not matters.can_propose(state, racket, capo)
    matters.run(state, rng, tuned(advice={"follow_min": 1.0, "follow_max": 1.0}))
    assert state.rackets["docks_pier_9"].capo_id == "capo_marchetti"


def test_proposing_for_an_unattended_racket(fresh):
    state, rng = fresh
    state.rackets["docks_pier_9"].capo_id = None
    apply(state, rng, ProposeReassign(racket_id="docks_pier_9", capo_id="capo_amaro"))
    assert state.matters[0].event_id == "assignment"


def test_matter_ids_stay_unique(fresh):
    state, rng = fresh
    apply(state, rng, ProposeReassign(racket_id="docks_pier_9", capo_id="capo_marchetti"))
    apply(state, rng, ProposeReassign(racket_id="numbers_eastside", capo_id="capo_marchetti"))
    ids = [m.id for m in state.matters]
    assert len(set(ids)) == 2 and ids[1].endswith("-2")


def test_envelopes_name_their_racket(game):
    state, rng = game
    apply(state, rng, EndMonth())
    entry = state.knowledge.ledger[-1]
    assert {line.racket_id for line in entry.kickups} == {r.id for r in state.rackets.values() if r.family_id == "ferrante"}
    assert all(line.racket_id is None for line in entry.expenses)


def test_version_6_save_upgrades(game):
    state, rng = game
    data = json.loads(to_json(state, rng))
    data["schema_version"] = 6
    for key in ("notes", "pinned", "flagged"):
        del data["knowledge"][key]
    loaded, _ = from_json(json.dumps(data))
    assert loaded.knowledge.notes == {} and loaded.knowledge.pinned == []
