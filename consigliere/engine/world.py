"""The world beyond your desk: heat, the law, rival families, war and sit-downs.

Mirrored step for step in web/engine.js. Keep the order of every rng call identical.
"""

from __future__ import annotations

from .content import Balance, balance, sitdown_lines
from .mathutil import clamp
from .models import (
    Allegiance,
    Character,
    Decision,
    Expense,
    Investigation,
    InvestigationStage,
    KnownInvestigation,
    LedgerLine,
    Scheduled,
    SitDown,
    SitDownView,
    Source,
)
from .rng import GameRNG
from .state import WorldState

STAGES = ("peace", "insult", "sit-down", "retaliation", "blood", "war")
WAR = 5
INV_STAGES = list(InvestigationStage)
PUBLIC_STAGE = 2  # a grand jury is no secret


# ---- shared helpers (used by matters.py too) ----

def book(state: WorldState, label: str, amount: int) -> None:
    """Record money that moved outside the envelopes, in this month's books if open, else the next."""
    family = state.player_family
    family.treasury += amount
    entry = state.knowledge.ledger_for(state.month)
    line = LedgerLine(label=label, amount=amount)
    if entry is None:
        state.unbooked.append(line)
    else:
        entry.other.append(line)
        entry.treasury_end = family.treasury


def usable_sources(state: WorldState) -> list[Source]:
    return [
        s for s in state.sources.values()
        if s.active and (s.character_id is None or state.characters[s.character_id].alive)
    ]


def is_compromised(state: WorldState, source: Source) -> bool:
    if source.compromised:
        return True
    if source.character_id is None:
        return False
    return state.characters[source.character_id].hidden.allegiance != Allegiance.FAMILY


def schedule_news(state: WorldState, event_id: str, bindings: dict[str, str]) -> None:
    """Narration for something the engine did; it reaches your desk when the next month opens."""
    state.scheduled.append(Scheduled(event_id=event_id, month=state.month, bindings=bindings))


def remove_from_play(state: WorldState, man: Character, fate: str) -> None:
    man.alive = False
    man.fate = fate
    for racket in state.rackets.values():
        if racket.capo_id == man.id:
            racket.capo_id = None
    for src in state.sources.values():
        if src.character_id == man.id:
            src.active = False
            state.knowledge.sources[src.id].active = False
    state.investigations.pop(man.id, None)
    state.knowledge.investigations.pop(man.id, None)
    if man.id == state.player_family.don_id:
        state.flags["don_gone"] = state.month
    if man.id == state.player_id:
        state.flags["you_gone"] = state.month


def jail(state: WorldState, man: Character, bal: Balance) -> None:
    family = state.player_family
    remove_from_play(state, man, "jailed")
    if man.family_id == family.id and man.id != state.player_id:
        expense_id = f"family_of_{man.id}"
        if all(e.id != expense_id for e in family.expenses):
            family.expenses.append(Expense(id=expense_id, label=f"The family of {man.name}",
                                           amount=bal.law.family_support, stipend=True))
    if man.id == state.player_id:
        state.flags["you_jailed"] = state.month
    schedule_news(state, "indicted", {"man": man.id})


# ---- heat ----

def pressure(state: WorldState, character_id: str) -> int:
    """How hot a man is: the heat of the rackets he runs; the family's heat for the Don; Exposure for you."""
    family = state.player_family
    if character_id == state.player_id:
        return state.standing.exposure
    if character_id == family.don_id:
        return family.heat
    return sum(r.heat for r in state.rackets.values() if r.capo_id == character_id)


def district_heat(state: WorldState, district_id: str) -> int:
    rackets = [r.heat for r in state.rackets.values() if r.district_id == district_id]
    return round(sum(rackets) / len(rackets)) if rackets else 0


def run_heat(state: WorldState, rng: GameRNG, bal: Balance) -> None:
    hb = bal.heat
    for racket in state.rackets.values():
        cooled = rng.round_stochastic(racket.heat * hb.racket_decay)
        racket.heat = int(clamp(racket.heat + racket.heat_per_month - cooled))
    for family in state.families.values():
        rackets = [r.heat for r in state.rackets.values() if r.family_id == family.id]
        average = sum(rackets) / len(rackets) if rackets else 0
        family.heat = int(clamp(family.heat + rng.round_stochastic((average - family.heat) * hb.family_follow)))


# ---- the law ----

def investigation_stage(state: WorldState, character_id: str) -> int:
    """0 if nobody is investigating him, else 1 (surveillance) to 4 (indictment)."""
    inv = state.investigations.get(character_id)
    return 0 if inv is None else INV_STAGES.index(inv.stage) + 1


def honest_police_source(state: WorldState) -> bool:
    return any(s.kind == "police" and not is_compromised(state, s) for s in usable_sources(state))


def run_law(state: WorldState, rng: GameRNG, bal: Balance) -> None:
    lb = bal.law
    family = state.player_family
    for man in state.members(family.id):
        if not man.alive or man.id in state.investigations:
            continue
        chance = clamp((pressure(state, man.id) - lb.open_threshold) / lb.open_scale, 0, lb.open_max)
        if chance > 0 and rng.chance(chance):
            state.investigations[man.id] = Investigation(
                id=f"inv-{man.id}-{state.month}", target_id=man.id, agency="fbi", opened_month=state.month)

    for target_id in list(state.investigations):
        inv = state.investigations[target_id]
        step = lb.base_progress + pressure(state, target_id) / lb.pressure_divisor - lb.decay
        if "rat_active" in state.flags:
            step += lb.rat_bonus
        if "rat_turned" in state.flags:
            step -= lb.turned_relief
        progress = inv.progress + rng.round_stochastic(step)
        if progress >= 100:
            if inv.stage == InvestigationStage.INDICTMENT:
                jail(state, state.characters[target_id], bal)
                continue
            inv.stage = INV_STAGES[INV_STAGES.index(inv.stage) + 1]
            inv.progress = 0
        elif progress < 0:
            if inv.stage == InvestigationStage.SURVEILLANCE:
                del state.investigations[target_id]
                state.knowledge.investigations.pop(target_id, None)
                continue
            inv.progress = 0
        else:
            inv.progress = progress

    learn = lb.learn_base + (lb.learn_police if honest_police_source(state) else 0)
    for target_id, inv in state.investigations.items():
        known = state.knowledge.investigations.get(target_id)
        if known is not None:
            known.stage = inv.stage.value
            continue
        if INV_STAGES.index(inv.stage) >= PUBLIC_STAGE or rng.chance(learn):
            state.knowledge.investigations[target_id] = KnownInvestigation(
                target_id=target_id, stage=inv.stage.value, since=state.month)
            schedule_news(state, "investigation_learned", {"man": target_id})


# ---- rival families ----

def at_war(state: WorldState, family_id: str | None = None) -> bool:
    return any(r.stage == WAR and (family_id is None or r.family_id == family_id) for r in state.rivalries.values())


def run_rivals(state: WorldState, rng: GameRNG, bal: Balance) -> None:
    rb = bal.rivals
    ours = state.player_family
    for rivalry in state.rivalries.values():
        them = state.families[rivalry.family_id]
        if rivalry.stage == WAR:
            rivalry.war_months += 1
            our_loss = rng.randint(rb.war_loss_min, rb.war_loss_max) + (1 if them.strength > ours.strength + 10 else 0)
            their_loss = rng.randint(rb.war_loss_min, rb.war_loss_max) + (1 if ours.strength > them.strength + 10 else 0)
            ours.strength = int(clamp(ours.strength - our_loss))
            them.strength = int(clamp(them.strength - their_loss))
            book(state, f"The war with {them.name}", -rb.war_cost)
            them.treasury -= rb.war_cost
            if ours.strength <= rb.war_end_strength or them.strength <= rb.war_end_strength:
                won = ours.strength > them.strength
                loser = them.id if won else ours.id
                districts = [d.id for d in state.districts.values() if d.family_id == loser]
                rivalry.stage = 0
                rivalry.tension = 30
                rivalry.war_months = 0
                if districts:
                    schedule_news(state, "war_won" if won else "war_lost",
                                  {"rival": them.id, "district": rng.choice(districts)})
        else:
            boss = state.characters[them.don_id]
            aggression = sum(rb.aggression.get(t, 0.0) for t in boss.traits) if boss.alive else 0.0
            drift = aggression * rb.aggression_weight + (them.strength - ours.strength) / rb.strength_divisor
            drift += rng.uniform(-rb.noise, rb.noise)
            drift -= rivalry.tension * rb.calm_rate
            rivalry.tension = int(clamp(rivalry.tension + rng.round_stochastic(drift)))
    for family in state.families.values():
        fighting = at_war(state) if family.id == ours.id else at_war(state, family.id)
        if fighting:
            continue
        family.strength = int(clamp(family.strength + rng.round_stochastic((rb.base_strength - family.strength) * rb.regen_rate)))
    if at_war(state):
        for family in state.families.values():
            family.heat = int(clamp(family.heat + bal.heat.war_heat))


# ---- sit-downs ----

def sync_sitdown(state: WorldState) -> None:
    sd = state.sitdown
    if sd is None:
        state.knowledge.sitdown = None
        return
    state.knowledge.sitdown = SitDownView(
        rival_id=sd.rival_id, rival_name=state.families[sd.rival_id].name, round=sd.round,
        max_rounds=sd.max_rounds, ask=sd.ask, offer=sd.offer, patience=sd.patience, log=list(sd.log))


def say(key: str, **values: object) -> str:
    text = sitdown_lines()[key]
    for name, value in values.items():
        text = text.replace("{" + name + "}", f"${value:,}" if isinstance(value, int) else str(value))
    return text


def start_sitdown(state: WorldState, rng: GameRNG, rival_id: str, bal: Balance) -> None:
    sb = bal.sitdown
    them, ours = state.families[rival_id], state.player_family
    red_line = rng.randint(sb.red_line_min, sb.red_line_max)
    if them.strength > ours.strength:
        red_line += sb.stronger_premium
    if them.treasury < sb.broke_treasury:
        red_line -= sb.broke_discount
    red_line = max(0, red_line)
    ask = red_line + rng.randint(sb.opening_margin_min, sb.opening_margin_max)
    boss = state.characters[them.don_id]
    patience = sb.patience + (1 if "cautious" in boss.traits else 0) - (1 if "hothead" in boss.traits else 0)
    state.sitdown = SitDown(rival_id=rival_id, month=state.month, max_rounds=sb.max_rounds, ask=ask,
                            patience=patience, red_line=red_line, log=[say("open", family=them.name, ask=ask)])
    sync_sitdown(state)


def end_sitdown(state: WorldState, deal: bool, line: str, bal: Balance) -> None:
    sd = state.sitdown
    them = state.families[sd.rival_id]
    rivalry = state.rivalries[sd.rival_id]
    family = state.player_family
    trust = 0
    if deal:
        expense_id = f"tribute_{them.id}"
        family.expenses = [e for e in family.expenses if e.id != expense_id]
        if sd.offer > 0:
            family.expenses.append(Expense(id=expense_id, label=f"Tribute to {them.name}", amount=sd.offer))
        rivalry.stage = 0
        rivalry.tension = int(clamp(rivalry.tension - 40))
        if sd.offer - sd.red_line <= bal.sitdown.good_deal_margin:
            trust = 3
        chosen, tone = (f"A deal at ${sd.offer:,} a month" if sd.offer else "A deal for nothing"), ("good" if trust else "neutral")
    else:
        rivalry.stage = min(WAR, max(rivalry.stage, 2) + 1)
        rivalry.tension = int(clamp(rivalry.tension + 15))
        trust = -2
        chosen, tone = "No deal", "bad"
    state.standing.dons_trust = int(clamp(state.standing.dons_trust + trust))
    state.knowledge.decisions.append(Decision(
        month=state.month, matter_id=f"sitdown-{them.id}-{sd.month}", title=f"Sit-down with {them.name}",
        recommended=None, chosen=chosen, followed=None, tone=tone, text=line, trust_delta=trust))
    state.sitdown = None
    sync_sitdown(state)


SITDOWN_ACTIONS = ("concede", "hold", "threaten", "walk")


def sitdown_act(state: WorldState, action: str, bal: Balance | None = None) -> None:
    """One round of the sit-down. You speak for the family here; the Don is not at the table."""
    bal = bal or balance()
    sb = bal.sitdown
    sd = state.sitdown
    them, ours = state.families[sd.rival_id], state.player_family
    rivalry = state.rivalries[sd.rival_id]
    if action == "walk":
        end_sitdown(state, False, say("you_walk", family=them.name), bal)
        return
    if action == "concede":
        sd.offer += sb.concession
        sd.ask -= sb.ask_drop
        key = "concede"
    elif action == "hold":
        sd.patience -= 1
        if them.treasury < sb.broke_treasury:
            sd.ask -= sb.hold_drop
            key = "hold_gives"
        else:
            key = "hold"
    else:
        if ours.strength >= them.strength + sb.threat_margin:
            sd.ask -= sb.threat_drop
            rivalry.tension = int(clamp(rivalry.tension + 10))
            key = "threat_lands"
        else:
            sd.patience -= 2
            rivalry.tension = int(clamp(rivalry.tension + 15))
            key = "threat_fails"
    sd.ask = max(sd.ask, sd.red_line)
    sd.log.append(say(key, offer=sd.offer, ask=sd.ask, family=them.name))
    if sd.offer >= sd.ask:
        end_sitdown(state, True, say("deal", offer=sd.offer, family=them.name), bal)
    elif sd.patience <= 0 or sd.round >= sd.max_rounds:
        end_sitdown(state, False, say("they_walk", family=them.name), bal)
    else:
        sd.round += 1
        sync_sitdown(state)


# ---- the monthly system ----

def run(state: WorldState, rng: GameRNG, bal: Balance | None = None) -> None:
    """A sit-down left unfinished breaks up; then heat, the law and the rivals move."""
    bal = bal or balance()
    if state.sitdown is not None and state.sitdown.month < state.month:
        end_sitdown(state, False, say("abandoned", family=state.families[state.sitdown.rival_id].name), bal)
    run_heat(state, rng, bal)
    run_law(state, rng, bal)
    run_rivals(state, rng, bal)
