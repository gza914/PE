import pytest

from consigliere.engine.content import balance
from consigliere.engine.rng import GameRNG
from consigliere.engine.systems import economy
from tests.helpers import tuned


def capo(state, capo_id):
    return state.characters[capo_id]


def test_kickup_plus_skim_is_what_he_owes(game):
    state, _ = game
    econ = tuned(economy={"income_variance": 0}).economy
    racket = state.rackets["loans_garment"]
    tessaro = capo(state, "capo_tessaro")
    kickup, skim = economy.collect(racket, tessaro, econ, GameRNG(1))
    competence = econ.competence_floor + 2 * (1 - econ.competence_floor) * tessaro.stats.competence / 100
    owed = round(racket.income * competence * (1 - econ.capo_share))
    assert kickup + skim == owed
    assert skim > 0


def test_loyal_frugal_capo_does_not_skim(game):
    state, _ = game
    rng = GameRNG(2)
    amaro = capo(state, "capo_amaro")
    assert all(economy.skim_fraction(amaro, balance().economy, rng) == 0 for _ in range(50))


def test_skim_rises_with_greed_and_disloyalty_and_is_capped(game):
    state, _ = game
    econ = tuned(economy={"skim_noise": 0}).economy
    tessaro = capo(state, "capo_tessaro")
    before = economy.skim_fraction(tessaro, econ, GameRNG(0))
    tessaro.stats.loyalty = 10
    tessaro.stats.greed = 100
    after = economy.skim_fraction(tessaro, econ, GameRNG(0))
    assert after > before
    assert after <= econ.max_skim


def test_unattended_racket_trickles_in(game):
    state, _ = game
    econ = tuned(economy={"income_variance": 0}).economy
    racket = state.rackets["docks_pier_9"]
    assert economy.collect(racket, None, econ, GameRNG(0)) == (round(racket.income * economy.UNATTENDED_YIELD), 0)


def test_month_books_balance_and_stash_grows(game):
    state, rng = game
    start = state.player_family.treasury
    economy.run(state, rng)
    entry = state.knowledge.ledger[-1]
    assert entry.month == 0
    assert entry.treasury_start == start
    assert entry.treasury_end == start + entry.total_in - entry.total_out == state.player_family.treasury
    assert len(entry.kickups) == 6
    assert capo(state, "capo_tessaro").hidden.stash > 0
    assert capo(state, "capo_amaro").hidden.stash == 0


def test_broke_family_misses_stipend_and_men_remember(game):
    state, rng = game
    family = state.player_family
    family.treasury = 0
    for racket in state.rackets.values():
        racket.income = 0
    economy.run(state, rng)
    entry = state.knowledge.ledger[-1]
    assert all(line.note == "unpaid" for line in entry.expenses)
    assert family.treasury == 0
    for member in state.members(family.id):
        missed = [m for m in member.memory if m.event_id == "stipend_missed"]
        assert bool(missed) == (member.id != family.don_id)


@pytest.mark.parametrize("treasury", [0, 5000, 100000])
def test_treasury_never_negative(game, treasury):
    state, rng = game
    state.player_family.treasury = treasury
    for racket in state.rackets.values():
        racket.income = 0
    economy.run(state, rng)
    assert state.player_family.treasury >= 0
