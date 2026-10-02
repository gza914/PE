from consigliere.engine.content import balance, observations
from consigliere.engine.models import Role


def test_balance_loads():
    assert 0 < balance().economy.capo_share < 1


def test_bands_cover_every_loyalty():
    obs = observations()
    for loyalty in range(101):
        obs.band_for(loyalty)
    ids = [b.id for b in obs.loyalty_bands]
    assert len(ids) == len(set(ids))


def test_every_observation_names_its_subject():
    for band in observations().loyalty_bands:
        for line in band.lines:
            assert "{name}" in line
            line.format(name="X")


def test_default_scenario_has_milestone_two_cast(game):
    state, _ = game
    family = state.player_family
    capos = [m for m in state.members(family.id) if m.role is Role.CAPO]
    assert len(capos) == 4
    ours = [r for r in state.rackets.values() if r.family_id == family.id]
    assert len(ours) == 6
    for racket in ours:
        assert state.characters[racket.capo_id].role is Role.CAPO
        assert racket.capo_id in family.member_ids
    assert any(e.stipend for e in family.expenses)


def test_event_placeholders_all_resolve():
    import re

    from consigliere.engine.content import events

    for event in events().values():
        names = set(event.cast) | set(event.carries) | set(event.lists) | {"don", "you", "family"}
        names |= {r for e in event.arise_effects if e.kind == "assign_roles" for r in e.assign_roles.roles}
        texts = [event.title, event.text] + [o.label for o in event.options]
        texts += [out.text for o in event.options for out in o.outcomes]
        texts += [t for i in event.intel for t in (i.claim, i.denial)]
        for text in texts:
            for found in re.findall(r"\{(\w+)\}", text):
                assert found in names, f"{event.id}: {{{found}}} is not in its cast"


def test_vertical_slice_has_thirty_events():
    from consigliere.engine.content import events

    assert len(events()) >= 30
