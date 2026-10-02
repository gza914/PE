"""The advisory loop: matters arise, you recommend, the Don decides, consequences follow.

Mirrored step for step in web/engine.js. Keep the order of every rng call identical.
"""

from __future__ import annotations

from typing import Any

from .calendar import year_of
from .content import Balance, ContentError, balance, difficulties, events
from .eventdefs import STATS, Condition, Effect, EventDef, OptionDef
from .mathutil import clamp
from .eventdefs import IntelDef
from .models import (
    Allegiance,
    Headline,
    Racket,
    Role,
    Character,
    Decision,
    Expense,
    IntelReport,
    KnownSource,
    Matter,
    MatterIntel,
    MatterOption,
    Memory,
    NewsItem,
    Scheduled,
    Source,
)
from .rng import GameRNG
from .state import WorldState
from .lifecycle import crew_size, install_successor, recruit
from .world import (
    WAR,
    book,
    district_heat,
    investigation_stage,
    is_compromised,
    pressure,
    remove_from_play,
    start_sitdown,
    usable_sources,
)

WAIT = "wait"
HIDDEN = ("health", "stash", "birth_year", "debts")
SECRET = "?"  # binding keys starting with this hold a matter's secrets ("yes" / "no")


def cast_items(bindings: dict[str, str]) -> list[tuple[str, str]]:
    """Bindings that name characters or rackets, without the secrets."""
    return [(k, v) for k, v in bindings.items() if not k.startswith(SECRET)]


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
            "strength": family.strength,
            "heat": family.heat,
            "crew_size": crew_size(state),
        }
        if head in simple:
            return simple[head]
        return path  # a plain string literal
    if head == "flag":
        return 1 if attr in state.flags else 0
    if head == "secret":
        return 1 if bindings.get(SECRET + attr) == "yes" else 0
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
        if attr == "allegiance":
            return c.hidden.allegiance.value
        if attr == "id":
            return c.id
        if attr == "heat":
            return pressure(state, target)
        if attr == "investigation":
            return investigation_stage(state, target)
    elif target in state.rackets:
        r = state.rackets[target]
        if attr in ("income", "heat"):
            return getattr(r, attr)
        if attr == "kind":
            return r.kind.value
        if attr == "unattended":
            return 1 if r.capo_id is None else 0
        if attr == "ours":
            return 1 if r.family_id == family.id else 0
    elif target in state.families:
        f = state.families[target]
        if attr in ("strength", "wealth", "cohesion", "heat", "treasury"):
            return getattr(f, attr)
        rivalry = state.rivalries.get(target)
        if rivalry is not None and attr in ("stage", "tension", "war_months"):
            return getattr(rivalry, attr)
    elif target in state.districts:
        d = state.districts[target]
        if attr == "heat":
            return district_heat(state, target)
        if attr == "ours":
            return 1 if d.family_id == family.id else 0
    raise ContentError(f"cannot resolve {path!r}")


def check(state: WorldState, bindings: dict[str, str], cond: Condition, self_id: str | None = None) -> bool:
    if isinstance(cond, dict):
        return any(check(state, bindings, c, self_id) for c in cond["any"])
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
        kind = slot.kind
        if kind == "family":
            candidates = list(state.rivalries)
        elif kind == "district":
            owner = family.id if slot.district_of == "family" else bindings[slot.district_of]
            candidates = [d.id for d in state.districts.values() if d.family_id == owner]
        elif kind == "racket":
            candidates = [
                r.id for r in state.rackets.values()
                if (r.family_id == family.id if slot.racket_in is None else r.district_id == bindings[slot.racket_in])
                and (slot.racket_of is None or r.capo_id == bindings[slot.racket_of])
                and (slot.racket_not_of is None or r.capo_id != bindings[slot.racket_not_of])
            ]
        elif slot.boss_of is not None:
            boss = state.characters[state.families[bindings[slot.boss_of]].don_id]
            candidates = [boss.id] if boss.alive else []
        elif slot.investigated:
            taken = set(bindings.values())
            candidates = [
                m.id for m in state.members(family.id)
                if m.alive and m.id in state.knowledge.investigations and m.id not in taken
                and (slot.role is None or m.role in slot.role)
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


def exists(state: WorldState, ref: str) -> bool:
    return ref in state.characters or ref in state.rackets or ref in state.families or ref in state.districts


def name_of(state: WorldState, ref: str) -> str:
    return (state.characters.get(ref) or state.rackets.get(ref) or state.families.get(ref) or state.districts[ref]).name


def join_names(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def fill(text: str, state: WorldState, bindings: dict[str, str], lists: dict[str, list[str]] | None = None) -> str:
    for name, slots in (lists or {}).items():
        names = sorted(name_of(state, bindings[slot]) for slot in slots)
        text = text.replace("{" + name + "}", join_names(names))
    for name, ref in cast_items(bindings):
        if exists(state, ref):  # a racket closed since, say
            text = text.replace("{" + name + "}", name_of(state, ref))
    family = state.player_family
    text = text.replace("{don}", state.characters[family.don_id].name)
    text = text.replace("{you}", state.player.name)
    return text.replace("{family}", family.name)


def bindings_alive(state: WorldState, bindings: dict[str, str]) -> bool:
    return all(ref not in state.characters or state.characters[ref].alive for _, ref in cast_items(bindings))


# ---- effects ----

def targets(state: WorldState, bindings: dict[str, str], who: str) -> list[Character]:
    if who == "crew":
        return crew(state)
    return [state.characters[resolve_id(state, bindings, who)]]


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
    elif kind == "allegiance":
        for c in targets(state, bindings, value.who):
            c.hidden.allegiance = value.to
            c.hidden.allegiance_to = value.agency
    elif kind == "add_source":
        if value.id not in state.sources:
            character = bindings[value.character] if value.character else None
            state.sources[value.id] = Source(id=value.id, name=value.name, kind=value.kind,
                                             reliability=value.reliability, character_id=character)
            state.knowledge.sources[value.id] = KnownSource(name=value.name, kind=value.kind, believed=value.believed)
    elif kind == "compromise_source":
        if value in state.sources:
            state.sources[value].compromised = True
    elif kind == "remove_source":
        if value in state.sources:
            state.sources[value].active = False
            state.knowledge.sources[value].active = False
    elif kind == "assign_roles":
        pool = [bindings[slot] for slot in value.pool]
        rng.shuffle(pool)
        for role, ref in zip(value.roles, pool):
            bindings[role] = ref
    elif kind == "add_vice":
        for c in targets(state, bindings, value.who):
            if value.vice not in c.hidden.vices:
                c.hidden.vices.append(value.vice)
    elif kind in ("retire", "kill"):
        fate = "gone" if kind == "retire" else "killed"
        remove_from_play(state, state.characters[resolve_id(state, bindings, value)], fate)
    elif kind == "health":
        for c in targets(state, bindings, value.who):
            c.hidden.health = int(clamp(c.hidden.health + value.delta))
    elif kind == "rivalry":
        rivalry = state.rivalries[bindings[value.who]]
        stage = value.set_stage if value.set_stage is not None else int(clamp(rivalry.stage + value.stage, 0, WAR))
        rivalry.stage = stage
        if stage != WAR:
            rivalry.war_months = 0
        rivalry.tension = int(clamp(rivalry.tension + value.tension))
    elif kind == "transfer_district":
        district = state.districts[bindings[value.district]]
        district.family_id = family.id if value.to == "family" else bindings[value.to]
        for racket in state.rackets.values():
            if racket.district_id == district.id:
                racket.family_id = district.family_id
                racket.capo_id = None
    elif kind in ("strength", "heat"):
        target = family if value.who == "family" else state.families[bindings[value.who]]
        setattr(target, kind, int(clamp(getattr(target, kind) + value.delta)))
    elif kind == "sitdown":
        start_sitdown(state, rng, bindings[value], balance())
    elif kind == "investigation":
        inv = state.investigations.get(resolve_id(state, bindings, value.who))
        if inv is not None:
            inv.progress = int(clamp(inv.progress + value.progress, 0, 99))
    elif kind == "drop_investigation":
        target = resolve_id(state, bindings, value)
        state.investigations.pop(target, None)
        state.knowledge.investigations.pop(target, None)
    elif kind == "succession":
        backed = bindings[value.backed] if value.backed else None
        bindings["winner"] = install_successor(state, rng, [bindings[c] for c in value.candidates], backed)
    elif kind == "add_racket":
        racket_id = value.id if value.id not in state.rackets else f"{value.id}_{state.month}"
        state.rackets[racket_id] = Racket(
            id=racket_id, name=fill(value.name, state, bindings), kind=value.kind, family_id=family.id,
            capo_id=bindings[value.capo] if value.capo else None, district_id=bindings[value.district],
            income=value.income, heat_per_month=value.heat_per_month)
        bindings[value.bind] = racket_id
    elif kind == "remove_racket":
        state.rackets.pop(bindings.get(value, ""), None)
    elif kind == "defect":
        man = state.characters[resolve_id(state, bindings, value.who)]
        rival = state.families[bindings[value.to]]
        family.member_ids = [m for m in family.member_ids if m != man.id]
        rival.member_ids.append(man.id)
        man.family_id = rival.id
        man.role = Role.ASSOCIATE
        for racket in state.rackets.values():
            if racket.capo_id == man.id:
                racket.family_id = rival.id
                racket.capo_id = None
        state.knowledge.impressions.pop(man.id, None)
    elif kind == "promote":
        state.characters[resolve_id(state, bindings, value.who)].role = value.role
    elif kind == "recruit":
        bindings[value.bind] = recruit(state, rng, value.profile)
    elif kind == "unassign":
        target = resolve_id(state, bindings, value)
        for racket in state.rackets.values():
            if racket.capo_id == target:
                racket.capo_id = None


# ---- information ----

def other_sources(state: WorldState, kinds: list[str], about: str | None, exclude: set[str]) -> list[str]:
    """Sources that could speak to a claim: the right kinds first, anyone else if none of those."""
    pool = [s for s in usable_sources(state) if s.character_id is None or s.character_id != about]
    pool = [s for s in pool if s.id not in exclude]
    fitting = [s.id for s in pool if s.kind in kinds]
    return fitting or [s.id for s in pool]


def report_on(state: WorldState, rng: GameRNG, intel: IntelDef, bindings: dict[str, str], about: str | None,
              exclude: set[str]) -> IntelReport | None:
    candidates = other_sources(state, intel.sources, about, exclude)
    if not candidates:
        return None
    source = state.sources[rng.choice(candidates)]
    truth = check_all(state, bindings, intel.truth)
    if is_compromised(state, source):
        says = not truth
    else:
        says = truth if rng.chance(source.reliability) else not truth
    return IntelReport(source_id=source.id, says=says, month=state.month)


def apparent_trust(known: KnownSource, bal: Balance) -> float:
    """How far you trust a source: your first impression, revised by what he got right and wrong."""
    w = bal.information.prior_weight
    return (known.right + w * known.believed) / (known.right + known.wrong + w)


def can_verify(state: WorldState, matter: Matter, index: int, bal: Balance | None = None) -> bool:
    bal = bal or balance()
    item = matter.intel[index]
    event = events()[matter.event_id]
    used = {r.source_id for r in item.reports}
    return state.standing.influence >= bal.information.verify_cost and bool(
        other_sources(state, event.intel[index].sources, item.about, used))


def verify(state: WorldState, rng: GameRNG, matter: Matter, index: int, bal: Balance | None = None,
           evs: dict[str, EventDef] | None = None) -> IntelReport | None:
    """Spend Influence to hear what a second source says about a claim."""
    bal = bal or balance()
    evs = evs if evs is not None else events()
    if state.standing.influence < bal.information.verify_cost:
        return None
    item = matter.intel[index]
    report = report_on(state, rng, evs[matter.event_id].intel[index], matter.bindings, item.about,
                       {r.source_id for r in item.reports})
    if report is not None:
        state.standing.influence -= bal.information.verify_cost
        item.reports.append(report)
    return report


def reveal(state: WorldState, rng: GameRNG, matter: Matter, event: EventDef, bal: Balance) -> list[str]:
    """After a matter is settled the truth sometimes comes out, and you learn who to believe."""
    lines = []
    for item, intel in zip(matter.intel, event.intel):
        if not item.reports:
            continue
        chance = intel.reveal if intel.reveal is not None else bal.information.reveal_chance
        if not rng.chance(chance):
            continue
        truth = check_all(state, matter.bindings, intel.truth)
        right, wrong = [], []
        for report in item.reports:
            known = state.knowledge.sources[report.source_id]
            if report.says == truth:
                known.right += 1
                right.append(known.name)
            else:
                known.wrong += 1
                wrong.append(known.name)
        line = f"It came out: {item.claim if truth else item.denial}"
        if right:
            line += f" {join_names(right)} had it right."
        if wrong:
            line += f" {join_names(wrong)} had it wrong."
        lines.append(line)
    return lines


# ---- arising ----

def roll_secrets(event: EventDef, bindings: dict[str, str], rng: GameRNG) -> None:
    for name, p in event.secrets.items():
        if SECRET + name not in bindings:
            bindings[SECRET + name] = "yes" if rng.chance(p) else "no"


def make_matter(event: EventDef, bindings: dict[str, str], state: WorldState, rng: GameRNG) -> Matter:
    """Secrets are rolled, arising effects apply, then your sources tell you what they know."""
    state.event_log[event.id] = state.month
    matter_id = f"{event.id}-{state.month}"
    taken = {m.id for m in state.matters}
    n = 2
    while matter_id in taken:
        matter_id = f"{event.id}-{state.month}-{n}"
        n += 1
    roll_secrets(event, bindings, rng)
    for effect in event.arise_effects:
        apply_effect(state, effect, bindings, rng, event, fill(event.title, state, bindings, event.lists))
    intel = []
    for item in event.intel:
        about = bindings[item.about] if item.about else None
        known = MatterIntel(claim=fill(item.claim, state, bindings, event.lists),
                            denial=fill(item.denial, state, bindings, event.lists), about=about)
        report = report_on(state, rng, item, bindings, about, set())
        if report is not None:
            known.reports.append(report)
        intel.append(known)
    return Matter(
        id=matter_id,
        event_id=event.id,
        month=state.month,
        title=fill(event.title, state, bindings, event.lists),
        text=fill(event.text, state, bindings, event.lists),
        options=[MatterOption(id=o.id, label=fill(o.label, state, bindings, event.lists)) for o in event.options],
        bindings=bindings,
        can_wait=event.patience > 0,
        intel=intel,
    )


def print_headline(state: WorldState, text: str | None, bindings: dict[str, str], lists=None) -> None:
    if text:
        state.knowledge.papers.append(Headline(month=state.month, text=fill(text, state, bindings, lists), family=True))


def fire_news(state: WorldState, rng: GameRNG, event: EventDef, bindings: dict[str, str]) -> None:
    state.event_log[event.id] = state.month
    roll_secrets(event, bindings, rng)
    title = fill(event.title, state, bindings, event.lists)
    for effect in event.effects:
        apply_effect(state, effect, bindings, rng, event, title)
    text = fill(event.text, state, bindings, event.lists)
    state.knowledge.news.append(NewsItem(month=state.month, title=title, text=text))
    print_headline(state, event.headline, bindings, event.lists)


def run_scheduled(state: WorldState, rng: GameRNG, evs: dict[str, EventDef]) -> None:
    due = [s for s in state.scheduled if s.month <= state.month]
    state.scheduled = [s for s in state.scheduled if s.month > state.month]
    for item in due:
        event = evs[item.event_id]
        if not event.even_if_gone and not bindings_alive(state, item.bindings):
            continue
        if not check_all(state, item.bindings, item.when + event.trigger):
            continue
        if event.kind == "news":
            fire_news(state, rng, event, item.bindings)
        elif all(m.event_id != event.id for m in state.matters):
            state.matters.append(make_matter(event, item.bindings, state, rng))


def eligible(state: WorldState, rng: GameRNG, evs: dict[str, EventDef]) -> list[tuple[EventDef, dict[str, str]]]:
    pending = {m.event_id for m in state.matters}
    found = []
    for event in evs.values():
        if event.followup_only or event.weight <= 0 or event.id in pending:
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
        if event.kind == "news":
            fire_news(state, rng, event, bindings)
        else:
            state.matters.append(make_matter(event, bindings, state, rng))


# ---- the Don decides ----

def follow_chance(state: WorldState, don: Character, bal: Balance) -> float:
    adv = bal.advice
    p = adv.follow_base + adv.follow_trust_weight * state.standing.dons_trust / 100 + adv.follow_mood_weight * (state.don_mood - 50) / 50
    p += sum(adv.follow_traits.get(t, 0.0) for t in don.traits)
    p += difficulties()[state.difficulty].follow_bonus
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
    if event.you_decide:
        rec = rec if rec != WAIT else None
        choice, followed = (rec if rec is not None else event.default_option), None
    elif rec is None:
        choice, followed = don_preference(event, don, rng, bal), None
    else:
        own = don_preference(event, don, rng, bal)
        if rng.chance(follow_chance(state, don, bal)):
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
    if rec is not None and not event.you_decide:
        trust = getattr(bal.advice.trust, f"{'followed' if followed else 'ignored'}_{outcome.tone}")
        state.standing.dons_trust = int(clamp(state.standing.dons_trust + trust))
    if not event.you_decide:
        state.don_mood = int(clamp(state.don_mood + getattr(bal.mood, outcome.tone)))
    state.knowledge.decisions.append(Decision(
        month=state.month, matter_id=matter.id, title=matter.title, recommended=label_of(matter, rec),
        chosen=label_of(matter, choice), followed=followed, tone=outcome.tone,
        text=fill(outcome.text, state, matter.bindings, event.lists), trust_delta=trust,
        revealed=reveal(state, rng, matter, event, bal),
    ))
    print_headline(state, outcome.headline, matter.bindings, event.lists)
    return False


def run(state: WorldState, rng: GameRNG, bal: Balance | None = None, evs: dict[str, EventDef] | None = None) -> None:
    """Monthly system: the Don settles every matter on the desk, then his mood settles too."""
    bal = bal or balance()
    evs = evs if evs is not None else events()
    his = [m for m in state.matters if not evs[m.event_id].you_decide]
    silent = bool(his) and all(m.recommendation is None for m in his)
    state.matters = [m for m in list(state.matters) if resolve(state, m, rng, bal, evs)]
    if silent and state.standing.dons_trust > bal.advice.silence_floor:
        state.standing.dons_trust = int(clamp(state.standing.dons_trust - bal.advice.silence_penalty))
    shift = (50 - state.don_mood) * bal.mood.drift_rate
    state.don_mood = int(clamp(state.don_mood + rng.round_stochastic(shift)))
    state.standing.influence = int(clamp(state.standing.influence + bal.information.monthly_influence))


# ---- matters you put on the desk yourself ----

FLAG_COOLDOWN = 6


def can_flag(state: WorldState, capo_id: str) -> bool:
    """You can bring the Don a capo's numbers once every six months."""
    man = state.characters.get(capo_id)
    if man is None or not man.alive or man.family_id != state.player_family.id or man.id == state.player_id:
        return False
    if man.id == state.player_family.don_id or not any(r.capo_id == man.id for r in state.rackets.values()):
        return False
    last = state.knowledge.flagged.get(capo_id)
    pending = any(m.event_id == "flagged_books" and m.bindings.get("capo") == capo_id for m in state.matters)
    return not pending and (last is None or state.month - last >= FLAG_COOLDOWN)


def flag_books(state: WorldState, rng: GameRNG, capo_id: str) -> Matter:
    state.knowledge.flagged[capo_id] = state.month
    matter = make_matter(events()["flagged_books"], {"capo": capo_id}, state, rng)
    state.matters.append(matter)
    return matter


def can_propose(state: WorldState, racket_id: str, capo_id: str) -> bool:
    """A racket of ours can be proposed for a living capo of ours who doesn't already run it."""
    racket, man = state.rackets.get(racket_id), state.characters.get(capo_id)
    family = state.player_family
    if racket is None or man is None or racket.family_id != family.id or racket.capo_id == capo_id:
        return False
    if not man.alive or man.family_id != family.id or man.role not in (Role.CAPO, Role.UNDERBOSS):
        return False
    return not any(m.event_id in ("reassignment", "assignment") and m.bindings.get("racket") == racket_id
                   for m in state.matters)


def propose(state: WorldState, rng: GameRNG, racket_id: str, capo_id: str) -> Matter:
    """Put a racket's move to the Don. You are on record for it: your advice is to do it."""
    current = state.rackets[racket_id].capo_id
    if current is None:
        matter = make_matter(events()["assignment"], {"racket": racket_id, "to": capo_id}, state, rng)
    else:
        matter = make_matter(events()["reassignment"], {"racket": racket_id, "from": current, "to": capo_id}, state, rng)
    matter.recommendation = "move"
    state.matters.append(matter)
    return matter
