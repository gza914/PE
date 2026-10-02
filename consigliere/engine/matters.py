"""The advisory loop: matters arise, you recommend, the Don decides, consequences follow.

Mirrored step for step in web/engine.js. Keep the order of every rng call identical.
"""

from __future__ import annotations

from typing import Any

from .calendar import year_of
from .content import Balance, ContentError, balance, events
from .eventdefs import STATS, Condition, Effect, EventDef, OptionDef
from .mathutil import clamp
from .models import Character, Decision, Expense, LedgerLine, Matter, MatterOption, Memory, NewsItem, Scheduled
from .rng import GameRNG
from .state import WorldState

WAIT = "wait"
HIDDEN = ("health", "stash", "birth_year", "debts")


# ---- conditions ----

def crew(state: WorldState) -> list[Character]:
    """Everyone in your family except the Don and you."""
    family = state.player_family
    return [m for m in state.members(family.id) if m.alive and m.id not in (family.don_id, state.player_id)]


def resolve_id(state: WorldState, bindings: dict[str, str], name: str, self_id: str | None = None) -> str | None:
    if name == "self":
        return self_id
    if name == "don":
        return state.player_family.don_id
    if name == "you":
        return state.player_id
    return bindings.get(name)


def lookup(state: WorldState, bindings: dict[str, str], path: Any, self_id: str | None = None) -> Any:
    if not isinstance(path, str):
        return path
    head, _, attr = path.partition(".")
    family = state.player_family
    if not attr:
        simple = {
            "treasury": family.treasury,
            "cohesion": family.cohesion,
            "month": state.month,
            "year": year_of(state.month),
            "dons_trust": state.standing.dons_trust,
            "influence": state.standing.influence,
            "exposure": state.standing.exposure,
            "don_mood": state.don_mood,
        }
        if head in simple:
            return simple[head]
        return path  # a plain string literal
    if head == "flag":
        return 1 if attr in state.flags else 0
    target = resolve_id(state, bindings, head, self_id)
    if target in state.characters:
        c = state.characters[target]
        if attr in STATS:
            return getattr(c.stats, attr)
        if attr in HIDDEN:
            return getattr(c.hidden, attr)
        if attr == "age":
            return year_of(state.month) - c.hidden.birth_year
        if attr == "rackets":
            return sum(1 for r in state.rackets.values() if r.capo_id == target)
        if attr == "alive":
            return 1 if c.alive else 0
    elif target in state.rackets:
        r = state.rackets[target]
        if attr in ("income", "heat"):
            return getattr(r, attr)
        if attr == "kind":
            return r.kind.value
    raise ContentError(f"cannot resolve {path!r}")


def check(state: WorldState, bindings: dict[str, str], cond: Condition, self_id: str | None = None) -> bool:
    left, op, right = cond
    if op in ("has", "lacks"):
        target = resolve_id(state, bindings, left, self_id)
        c = state.characters[target]
        found = right in [t.value for t in c.traits] or right in c.hidden.vices
        return found if op == "has" else not found
    a = lookup(state, bindings, left, self_id)
    b = lookup(state, bindings, right, self_id)
    if op == "<":
        return a < b
    if op == "<=":
        return a <= b
    if op == ">":
        return a > b
    if op == ">=":
        return a >= b
    if op == "==":
        return a == b
    return a != b


def check_all(state: WorldState, bindings: dict[str, str], conds: list[Condition], self_id: str | None = None) -> bool:
    return all(check(state, bindings, c, self_id) for c in conds)


# ---- casting and text ----

def bind(event: EventDef, state: WorldState, rng: GameRNG) -> dict[str, str] | None:
    bindings: dict[str, str] = {}
    family = state.player_family
    for name, slot in event.cast.items():
        if slot.is_racket:
            candidates = [
                r.id for r in state.rackets.values()
                if r.family_id == family.id
                and (slot.racket_of is None or r.capo_id == bindings[slot.racket_of])
                and (slot.racket_not_of is None or r.capo_id != bindings[slot.racket_not_of])
            ]
        else:
            roles = slot.role or []
            taken = set(bindings.values())
            candidates = [
                m.id for m in state.members(family.id)
                if m.alive and m.role in roles and m.id not in taken
                and (slot.runs is None or state.rackets[bindings[slot.runs]].capo_id == m.id)
            ]
        candidates = [c for c in candidates if check_all(state, bindings, slot.where, self_id=c)]
        if not candidates:
            return None
        bindings[name] = rng.choice(candidates)
    return bindings


def fill(text: str, state: WorldState, bindings: dict[str, str]) -> str:
    for name, ref in bindings.items():
        thing = state.characters.get(ref) or state.rackets.get(ref)
        text = text.replace("{" + name + "}", thing.name)
    family = state.player_family
    text = text.replace("{don}", state.characters[family.don_id].name)
    text = text.replace("{you}", state.player.name)
    return text.replace("{family}", family.name)


def bindings_alive(state: WorldState, bindings: dict[str, str]) -> bool:
    return all(ref in state.rackets or (ref in state.characters and state.characters[ref].alive) for ref in bindings.values())


# ---- effects ----

def targets(state: WorldState, bindings: dict[str, str], who: str) -> list[Character]:
    if who == "crew":
        return crew(state)
    return [state.characters[resolve_id(state, bindings, who)]]


def book(state: WorldState, label: str, amount: int) -> None:
    """Record money a decision moved, in this month's books if they are open, else the next."""
    family = state.player_family
    family.treasury += amount
    entry = state.knowledge.ledger_for(state.month)
    line = LedgerLine(label=label, amount=amount)
    if entry is None:
        state.unbooked.append(line)
    else:
        entry.other.append(line)
        entry.treasury_end = family.treasury


def apply_effect(state: WorldState, effect: Effect, bindings: dict[str, str], rng: GameRNG, source: EventDef, label: str) -> None:
    kind = effect.kind
    value = getattr(effect, kind)
    family = state.player_family
    if kind == "stat":
        for c in targets(state, bindings, value.who):
            setattr(c.stats, value.stat, int(clamp(getattr(c.stats, value.stat) + value.delta)))
    elif kind == "memory":
        about = {"family": family.id}.get(value.about) or resolve_id(state, bindings, value.about)
        for c in targets(state, bindings, value.who):
            c.memory.append(Memory(event_id=source.id, about_id=about, month=state.month, weight=value.weight, decay_rate=value.decay))
    elif kind == "standing":
        s = state.standing
        s.dons_trust = int(clamp(s.dons_trust + value.dons_trust))
        s.influence = int(clamp(s.influence + value.influence))
        s.exposure = int(clamp(s.exposure + value.exposure))
    elif kind == "treasury":
        book(state, label, value)
    elif kind == "don_mood":
        state.don_mood = int(clamp(state.don_mood + value))
    elif kind == "cohesion":
        family.cohesion = int(clamp(family.cohesion + value))
    elif kind == "assign_racket":
        state.rackets[bindings[value.racket]].capo_id = bindings[value.to] if value.to else None
    elif kind == "racket_income":
        racket = state.rackets[bindings[value.racket]]
        racket.income = max(0, round(racket.income * (100 + value.pct) / 100))
    elif kind == "flag":
        state.flags[value] = state.month
    elif kind == "clear_flag":
        state.flags.pop(value, None)
    elif kind == "followup":
        delay = rng.randint(value.after[0], value.after[1])
        state.scheduled.append(Scheduled(event_id=value.event, month=state.month + delay, bindings=dict(bindings), when=value.when))
    elif kind == "add_expense":
        if all(e.id != value.id for e in family.expenses):
            family.expenses.append(Expense(id=value.id, label=value.label, amount=value.amount, stipend=value.stipend))
    elif kind == "change_expense":
        for e in family.expenses:
            if e.id == value.id:
                e.amount = max(0, e.amount + value.delta)
    elif kind == "remove_expense":
        family.expenses = [e for e in family.expenses if e.id != value]


# ---- arising ----

def make_matter(event: EventDef, bindings: dict[str, str], state: WorldState) -> Matter:
    state.event_log[event.id] = state.month
    return Matter(
        id=f"{event.id}-{state.month}",
        event_id=event.id,
        month=state.month,
        title=fill(event.title, state, bindings),
        text=fill(event.text, state, bindings),
        options=[MatterOption(id=o.id, label=fill(o.label, state, bindings)) for o in event.options],
        bindings=bindings,
        can_wait=event.patience > 0,
    )


def run_scheduled(state: WorldState, rng: GameRNG, evs: dict[str, EventDef]) -> None:
    due = [s for s in state.scheduled if s.month <= state.month]
    state.scheduled = [s for s in state.scheduled if s.month > state.month]
    for item in due:
        event = evs[item.event_id]
        if not bindings_alive(state, item.bindings):
            continue
        if not check_all(state, item.bindings, item.when + event.trigger):
            continue
        if event.kind == "news":
            state.event_log[event.id] = state.month
            title = fill(event.title, state, item.bindings)
            for effect in event.effects:
                apply_effect(state, effect, item.bindings, rng, event, title)
            state.knowledge.news.append(NewsItem(month=state.month, title=title, text=fill(event.text, state, item.bindings)))
        elif all(m.event_id != event.id for m in state.matters):
            state.matters.append(make_matter(event, item.bindings, state))


def eligible(state: WorldState, rng: GameRNG, evs: dict[str, EventDef]) -> list[tuple[EventDef, dict[str, str]]]:
    pending = {m.event_id for m in state.matters}
    found = []
    for event in evs.values():
        if event.kind != "matter" or event.followup_only or event.weight <= 0 or event.id in pending:
            continue
        last = state.event_log.get(event.id)
        if last is not None and (event.once or state.month - last < event.cooldown):
            continue
        bindings = bind(event, state, rng)
        if bindings is None or not check_all(state, bindings, event.trigger):
            continue
        found.append((event, bindings))
    return found


def begin_month(state: WorldState, rng: GameRNG, bal: Balance | None = None, evs: dict[str, EventDef] | None = None) -> None:
    """Follow-ups come due, then new matters reach your desk."""
    bal = bal or balance()
    evs = evs if evs is not None else events()
    run_scheduled(state, rng, evs)
    count = rng.randint(bal.matters.per_month_min, bal.matters.per_month_max)
    pool = eligible(state, rng, evs)
    for _ in range(min(count, len(pool))):
        event, bindings = pool.pop(rng.weighted_index([e.weight for e, _ in pool]))
        state.matters.append(make_matter(event, bindings, state))


# ---- the Don decides ----

def follow_chance(state: WorldState, don: Character, bal: Balance) -> float:
    adv = bal.advice
    p = adv.follow_base + adv.follow_trust_weight * state.standing.dons_trust / 100 + adv.follow_mood_weight * (state.don_mood - 50) / 50
    p += sum(adv.follow_traits.get(t, 0.0) for t in don.traits)
    return clamp(p, adv.follow_min, adv.follow_max)


def don_preference(event: EventDef, don: Character, rng: GameRNG, bal: Balance) -> str:
    best, best_score = event.options[0].id, None
    for option in event.options:
        score = option.don.get("base", 0.0) + sum(option.don.get(t.value, 0.0) for t in don.traits)
        score += rng.uniform(-bal.advice.don_noise, bal.advice.don_noise)
        if best_score is None or score > best_score:
            best, best_score = option.id, score
    return best


def pick_outcome(option: OptionDef, state: WorldState, bindings: dict[str, str], rng: GameRNG):
    weights = []
    for outcome in option.outcomes:
        weight = outcome.weight
        for mod in outcome.weight_if:
            if check_all(state, bindings, mod.when):
                weight *= mod.mult
        weights.append(weight)
    return option.outcomes[rng.weighted_index(weights)]


def label_of(matter: Matter, choice: str | None) -> str | None:
    if choice is None:
        return None
    if choice == WAIT:
        return "Let it wait"
    return next(o.label for o in matter.options if o.id == choice)


def resolve(state: WorldState, matter: Matter, rng: GameRNG, bal: Balance, evs: dict[str, EventDef]) -> bool:
    """Settle one matter. Returns True if it stays on the desk another month."""
    event = evs[matter.event_id]
    don = state.characters[state.player_family.don_id]
    rec = matter.recommendation
    if rec == WAIT and not (matter.can_wait and matter.waited < event.patience):
        rec = None
    own = don_preference(event, don, rng, bal)
    if rec is None:
        choice, followed = own, None
    elif rng.chance(follow_chance(state, don, bal)):
        choice, followed = rec, True
    else:
        choice, followed = own, own == rec

    if choice == WAIT:
        matter.waited += 1
        matter.recommendation = None
        matter.can_wait = matter.waited < event.patience
        state.knowledge.decisions.append(Decision(
            month=state.month, matter_id=matter.id, title=matter.title, recommended=label_of(matter, rec),
            chosen=label_of(matter, WAIT), followed=followed, tone="waiting",
            text="The Don lets it sit another month.",
        ))
        return True

    option = event.option(choice)
    outcome = pick_outcome(option, state, matter.bindings, rng)
    for effect in outcome.effects:
        apply_effect(state, effect, matter.bindings, rng, event, matter.title)
    if followed and option.advised_exposure:
        state.standing.exposure = int(clamp(state.standing.exposure + option.advised_exposure))
    trust = 0
    if rec is not None:
        trust = getattr(bal.advice.trust, f"{'followed' if followed else 'ignored'}_{outcome.tone}")
        state.standing.dons_trust = int(clamp(state.standing.dons_trust + trust))
    state.don_mood = int(clamp(state.don_mood + getattr(bal.mood, outcome.tone)))
    state.knowledge.decisions.append(Decision(
        month=state.month, matter_id=matter.id, title=matter.title, recommended=label_of(matter, rec),
        chosen=label_of(matter, choice), followed=followed, tone=outcome.tone,
        text=fill(outcome.text, state, matter.bindings), trust_delta=trust,
    ))
    return False


def run(state: WorldState, rng: GameRNG, bal: Balance | None = None, evs: dict[str, EventDef] | None = None) -> None:
    """Monthly system: the Don settles every matter on the desk, then his mood settles too."""
    bal = bal or balance()
    evs = evs if evs is not None else events()
    state.matters = [m for m in list(state.matters) if resolve(state, m, rng, bal, evs)]
    shift = (50 - state.don_mood) * bal.mood.drift_rate
    state.don_mood = int(clamp(state.don_mood + rng.round_stochastic(shift)))
