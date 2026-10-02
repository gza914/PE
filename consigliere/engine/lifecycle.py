"""Time: men age and die, Dons are replaced, and the story ends.

Mirrored step for step in web/engine.js. Keep the order of every rng call identical.
"""

from __future__ import annotations

from .calendar import year_of
from .content import Balance, balance, endings, observations, recruits
from .eventdefs import STATS
from .mathutil import clamp
from .models import Character, Ending, HiddenState, Memoir, Role, Stats
from .rng import GameRNG
from .state import WorldState
from .world import remove_from_play, schedule_news


# ---- aging and death ----

def run_aging(state: WorldState, rng: GameRNG, bal: Balance) -> None:
    lb = bal.life
    for man in list(state.characters.values()):
        if not man.alive:
            continue
        age = year_of(state.month) - man.hidden.birth_year
        chance = max(0, age - lb.age_threshold) * lb.age_rate
        if man.role in (Role.DON, Role.RIVAL_BOSS):
            chance *= lb.don_factor
        chance += sum(lb.vice_rate.get(v, 0.0) for v in man.hidden.vices)
        if chance > 0 and rng.chance(chance):
            man.hidden.health = int(clamp(man.hidden.health - rng.randint(lb.decline_min, lb.decline_max)))
        if man.hidden.health < lb.spell_below and rng.chance(lb.spell_chance):
            man.hidden.health = int(clamp(man.hidden.health - rng.randint(lb.spell_min, lb.spell_max)))
        if man.hidden.health <= 0:
            remove_from_play(state, man, "died")
            if man.id != state.player_id:
                schedule_news(state, "funeral", {"man": man.id})


def run_rival_heirs(state: WorldState) -> None:
    """A rival family whose boss is gone is taken over by the next man in line."""
    ours = state.player_family.id
    for family in state.families.values():
        if family.id == ours or state.characters[family.don_id].alive:
            continue
        heir = next((state.characters[m] for m in family.member_ids if state.characters[m].alive), None)
        if heir is not None:
            heir.role = Role.RIVAL_BOSS
            family.don_id = heir.id
            schedule_news(state, "new_rival_boss", {"rival": family.id, "boss": heir.id})


def run(state: WorldState, rng: GameRNG, bal: Balance | None = None) -> None:
    bal = bal or balance()
    run_aging(state, rng, bal)
    run_rival_heirs(state)


# ---- new blood ----

def recruit(state: WorldState, rng: GameRNG, profile_id: str) -> str:
    """Make a soldier a capo. Name, temperament and ability come from content/recruits.yaml."""
    content = recruits()
    profile = content.profiles[profile_id]
    family = state.player_family
    taken = {c.name for c in state.characters.values()}
    for _ in range(20):
        name = f"{rng.choice(content.first_names)} {rng.choice(content.last_names)}"
        if name not in taken:
            break
    else:
        name += " Jr."
    stats = {stat: rng.randint(*profile.stats[stat]) for stat in STATS}
    traits = list(profile.traits) + [rng.choice(profile.extra_traits)]
    born = state.month // 12 + 1958 - rng.randint(28, 42)
    health = rng.randint(85, 100)
    man_id = f"capo_{state.month}_{len(family.member_ids)}"
    state.characters[man_id] = Character(
        id=man_id, name=name, role=Role.CAPO, family_id=family.id,
        traits=traits, stats=Stats(**stats), hidden=HiddenState(health=health, birth_year=born))
    family.member_ids.append(man_id)
    state.knowledge.impressions[man_id] = observations().band_for(stats["loyalty"]).id
    return man_id


# ---- succession in your family ----

def crew_size(state: WorldState) -> int:
    """Living capos and underboss: the men who could run a racket, or the family."""
    family = state.player_family
    return sum(1 for m in state.members(family.id)
               if m.alive and m.id != family.don_id and m.role in (Role.CAPO, Role.UNDERBOSS))


def install_successor(state: WorldState, rng: GameRNG, candidates: list[str], backed: str | None,
                      bal: Balance | None = None) -> str:
    """The capos choose a new Don. Your backing counts, more so with Influence behind it."""
    bal = bal or balance()
    sb = bal.succession
    family = state.player_family
    weights = []
    for cid in candidates:
        man = state.characters[cid]
        weight = man.stats.respect + man.stats.loyalty / 2
        if cid == backed:
            weight += sb.backing_bonus + state.standing.influence * sb.influence_weight
        weights.append(weight)
    winner = state.characters[candidates[rng.weighted_index(weights)]]
    for racket in state.rackets.values():
        if racket.capo_id == winner.id:
            racket.capo_id = None
    winner.role = Role.DON
    family.don_id = winner.id
    state.flags.pop("don_gone", None)
    state.flags["new_don"] = state.month
    state.don_mood = 50
    state.knowledge.dons.append(winner.name)
    if backed == winner.id:
        state.standing.dons_trust = sb.trust_backed_winner
    elif backed is None:
        state.standing.dons_trust = sb.trust_neutral
    elif rng.chance(sb.keep_base + state.standing.influence * sb.keep_influence):
        state.standing.dons_trust = sb.trust_backed_loser
    else:
        state.flags["pushed_out"] = state.month
    return winner.id


# ---- endings ----

def memoir(state: WorldState) -> Memoir:
    knowledge = state.knowledge
    family = state.player_family
    settled = [d for d in knowledge.decisions if d.tone != "waiting"]
    lost = [
        f"{m.name} ({m.fate})" for m in state.members(family.id)
        if not m.alive and m.id != state.player_id
    ]
    return Memoir(
        months=state.month + 1,
        dons=list(knowledge.dons),
        matters=len(settled),
        advised=sum(1 for d in settled if d.recommended is not None),
        taken=sum(1 for d in settled if d.followed is True),
        went_well=sum(1 for d in settled if d.tone == "good"),
        went_badly=sum(1 for d in settled if d.tone == "bad"),
        peak_treasury=max([e.treasury_end for e in knowledge.ledger] or [family.treasury]),
        final_treasury=family.treasury,
        districts=sum(1 for d in state.districts.values() if d.family_id == family.id),
        rat_found="rat_known" in state.flags,
        lost=lost,
        final_trust=state.standing.dons_trust,
    )


def which_ending(state: WorldState, bal: Balance) -> str | None:
    eb = bal.endings
    family = state.player_family
    you = state.player
    intact = family.strength >= eb.intact_strength and family.treasury >= eb.intact_treasury
    if "you_jailed" in state.flags:
        return "prison"
    if not you.alive:
        return "died" if you.fate == "died" else "killed"
    if "pushed_out" in state.flags:
        return "pushed_out"
    if state.standing.dons_trust <= 0:
        return "disposed"
    if state.standing.exposure >= eb.exile_exposure:
        return "exile"
    if family.strength <= eb.ruin_strength or family.treasury <= eb.ruin_treasury:
        return "ruin"
    if "don_gone" in state.flags and crew_size(state) == 0:
        return "ruin"
    if "retire" in state.flags:
        return "retired_intact" if intact else "retired_diminished"
    if state.month >= eb.last_month:
        return "era_intact" if intact else "era_diminished"
    return None


def check_endings(state: WorldState, rng: GameRNG, bal: Balance | None = None) -> None:
    """Last system of the month: if the story is over, write the ending and the memoir."""
    bal = bal or balance()
    if state.ending is not None:
        return
    ending_id = which_ending(state, bal)
    if ending_id is None:
        return
    spec = endings()[ending_id]
    years = (state.month + 1) // 12
    text = spec.text.replace("{you}", state.player.name).replace("{family}", state.player_family.name)
    text = text.replace("{years}", str(years)).replace("{don}", state.characters[state.player_family.don_id].name)
    state.ending = Ending(id=ending_id, month=state.month, rank=spec.rank, title=spec.title, text=text,
                          memoir=memoir(state))
