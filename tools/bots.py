"""Bot players for tools/simulate.py. Each strategy looks at the desk and sends commands.

Bots see what a player sees (matters, intel, the sit-down across the table) plus the event
definitions' published options. They never read hidden truth. Their own coin flips come from a
separately seeded GameRNG, so a simulation is reproducible from its seed.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from consigliere.engine.commands import (  # noqa: E402
    Command,
    FlagBooks,
    ProposeReassign,
    Recommend,
    SitDownAct,
    Talk,
    Verify,
)
from consigliere.engine.content import balance, events  # noqa: E402
from consigliere.engine.eventdefs import EventDef, OptionDef  # noqa: E402
from consigliere.engine.matters import WAIT, apparent_trust, can_flag, can_propose, can_verify, option_open  # noqa: E402
from consigliere.engine.models import Matter  # noqa: E402
from consigliere.engine.rng import GameRNG  # noqa: E402
from consigliere.engine.state import WorldState  # noqa: E402

ESCALATING = ("rivalry", "kill", "heat", "strength", "sitdown")


def outcome_shares(option: OptionDef) -> tuple[float, float]:
    """Share of good and bad outcomes, by published base weights (a bot can't see the truth)."""
    total = sum(o.weight for o in option.outcomes) or 1.0
    good = sum(o.weight for o in option.outcomes if o.tone == "good") / total
    bad = sum(o.weight for o in option.outcomes if o.tone == "bad") / total
    return good, bad


def effect_kinds(option: OptionDef) -> list:
    return [e for o in option.outcomes for e in o.effects]


def money(option: OptionDef) -> float:
    total = sum(o.weight for o in option.outcomes) or 1.0
    return sum(o.weight * sum(e.treasury for e in o.effects if e.kind == "treasury") for o in option.outcomes) / total


def risky(option: OptionDef) -> float:
    """How much an option invites trouble: exposure, heat, escalation, blood."""
    score = option.advised_exposure / 5
    for e in effect_kinds(option):
        if e.kind == "standing":
            score += max(0, e.standing.exposure) / 5
        elif e.kind == "rivalry":
            score += max(0, e.rivalry.stage) + (1 if (e.rivalry.set_stage or 0) >= 3 else 0)
        elif e.kind in ("kill", "sitdown"):
            score += 1
        elif e.kind == "heat":
            score += max(0, e.heat.delta) / 5
    return score


def votes_leader(state: WorldState, matter: Matter) -> str | None:
    """For a succession: back the man your most trusted report says has the votes."""
    best, best_trust = None, 0.5
    for item, option in zip(matter.intel, matter.options):
        for report in item.reports:
            trust = apparent_trust(state.knowledge.sources[report.source_id], balance())
            if report.says and trust > best_trust:
                best, best_trust = option.id, trust
    return best


BAND_RANK = {"estranged": 1, "restless": 2, "cooling": 3, "steady": 4, "devoted": 5}


def shortfall(state: WorldState, capo_id: str) -> float | None:
    """What the books show: his last six envelopes against what his rackets should bring."""
    share = balance().economy.capo_share
    man = state.characters[capo_id]
    ids = {r.id for r in state.rackets.values() if r.capo_id == capo_id}
    expected = sum(state.rackets[r].income * (1 - share) for r in ids)
    sums = []
    for entry in state.knowledge.ledger[-6:]:
        lines = [l.amount for l in entry.kickups if l.racket_id in ids and l.label.endswith(f"({man.name})")]
        if lines:
            sums.append(sum(lines))
    if not expected or len(sums) < 3:
        return None
    return 1 - (sum(sums) / len(sums)) / expected


def housekeeping(state: WorldState) -> list[Command]:
    """What an attentive player does with the books and the roster each month."""
    commands: list[Command] = []
    family = state.player_family
    crew = [m for m in state.members(family.id) if m.alive and m.role.value in ("capo", "underboss")]
    ranked = sorted(crew, key=lambda m: -BAND_RANK.get(state.knowledge.impressions.get(m.id, ""), 0))
    for man in crew:
        short = shortfall(state, man.id)
        if short is None or short < 0.15:
            continue
        if can_flag(state, man.id):
            commands.append(FlagBooks(capo_id=man.id))
            break
        flagged = state.knowledge.flagged.get(man.id)
        if short >= 0.25 and flagged is not None and state.month - flagged >= 3:
            racket = next((r for r in state.rackets.values() if r.capo_id == man.id), None)
            pick = next((m for m in ranked if m.id != man.id and can_propose(state, racket.id, m.id)), None) if racket else None
            if pick is not None:
                commands.append(ProposeReassign(racket_id=racket.id, capo_id=pick.id))
                break
    for racket in state.rackets.values():
        if racket.family_id != family.id or racket.capo_id is not None:
            continue
        pick = next((m for m in ranked if can_propose(state, racket.id, m.id)), None)
        if pick is not None:
            commands.append(ProposeReassign(racket_id=racket.id, capo_id=pick.id))
    return commands


class Bot:
    name = "base"
    attentive = False  # keeps the books and the roster

    def __init__(self, seed: int) -> None:
        self.rng = GameRNG(seed ^ 0x5EED_B07)

    # -- hooks --
    def choose(self, state: WorldState, matter: Matter, event: EventDef) -> str | None:
        return None

    def decide_own(self, state: WorldState, matter: Matter, event: EventDef) -> str | None:
        """Matters with no Don to ask: a succession, a retirement."""
        if matter.event_id == "retirement_offer":
            return "retire" if self.retires(state) else "not_yet"
        return votes_leader(state, matter) or event.default_option

    def retires(self, state: WorldState) -> bool:
        return state.month >= 108

    def sit(self, state: WorldState) -> str:
        sd = state.sitdown
        return "hold" if sd.round == 1 else "concede"

    def verifies(self) -> bool:
        return False

    talks = True  # sees everyone on a primary issue before advising

    def line(self, state: WorldState, lines: list[str]) -> int:
        """Which line to say. Bots can't tell which lines teach anything; they say the first."""
        return 0

    def converse(self, state: WorldState, matter: Matter) -> list[Talk]:
        """Talk to everyone, the Don last, until there is nothing more to say. Talk commands change what
        can be said next, so they are applied here, one by one, and returned only for the record."""
        from consigliere.engine.commands import apply as run_command
        said: list[Talk] = []
        if not self.talks:
            return said
        for _ in range(2):  # a second round: facts learned later open lines in earlier rooms
            for i, conversation in enumerate(matter.talks):
                for _ in range(40):
                    if not conversation.lines:
                        break
                    command = Talk(matter_id=matter.id, talk=i, line=self.line(state, conversation.lines))
                    run_command(state, self.world_rng, command)
                    said.append(command)
        return said

    # -- the month --
    def act(self, state: WorldState, rng: GameRNG | None = None) -> list[Command]:
        """This month's commands. Conversations are held on the spot, with the game's rng."""
        self.world_rng = rng
        commands: list[Command] = housekeeping(state) if self.attentive else []
        for matter in state.matters:
            event = events()[matter.event_id]
            if matter.primary and rng is not None:
                self.converse(state, matter)
                event = event.model_copy(update={"options": [o for o in event.options if option_open(matter, o)]})
            if self.verifies():
                for i, item in enumerate(matter.intel):
                    if len(item.reports) < 2 and can_verify(state, matter, i):
                        commands.append(Verify(matter_id=matter.id, intel_index=i))
            choice = self.decide_own(state, matter, event) if event.you_decide else self.choose(state, matter, event)
            if choice == WAIT and not matter.can_wait:
                choice = None
            commands.append(Recommend(matter_id=matter.id, choice=choice))
        return commands


class Silent(Bot):
    """Never advises the Don. Makes his own decisions as quietly as possible."""

    name = "silent"
    talks = False

    def decide_own(self, state: WorldState, matter: Matter, event: EventDef) -> str | None:
        return event.default_option

    def sit(self, state: WorldState) -> str:
        return "concede"


class Cautious(Bot):
    """Picks the option least likely to go wrong or draw attention; checks intel; makes peace."""

    name = "cautious"
    attentive = True

    def choose(self, state, matter, event):
        def score(option: OptionDef) -> float:
            good, bad = outcome_shares(option)
            return good - 2 * bad - risky(option)
        return max(event.options, key=score).id

    def verifies(self) -> bool:
        return True

    def sit(self, state):
        return "concede"


class Aggressive(Bot):
    """Picks the option that escalates; threatens at the table, then walks."""

    name = "aggressive"

    def choose(self, state, matter, event):
        def score(option: OptionDef) -> float:
            good, bad = outcome_shares(option)
            return risky(option) + good - bad / 2
        return max(event.options, key=score).id

    def retires(self, state):
        return False

    def sit(self, state):
        return "threaten" if state.sitdown.round < 3 else "walk"


class RandomBot(Bot):
    """Any option, waiting, or silence, at random; random moves at the table."""

    name = "random"

    def choose(self, state, matter, event):
        choices = [o.id for o in event.options] + ([WAIT] if matter.can_wait else []) + [None]
        return self.rng.choice(choices)

    def decide_own(self, state, matter, event):
        return self.rng.choice([o.id for o in event.options])

    def sit(self, state):
        return self.rng.choice(["concede", "hold", "threaten", "walk"])

    def line(self, state, lines):
        return self.rng.randint(0, len(lines) - 1)


class IgnoreTheLaw(Bot):
    """Follows the money and pays no attention to heat, Exposure or the courts."""

    name = "ignore_law"
    attentive = True

    def choose(self, state, matter, event):
        def score(option: OptionDef) -> float:
            good, bad = outcome_shares(option)
            return money(option) / 1000 + good - bad
        return max(event.options, key=score).id

    def sit(self, state):
        return "hold" if state.sitdown.round < 3 else "concede"


class Paper(Bot):
    """Picks whatever looks best on paper: the most good outcomes, the fewest bad."""

    name = "paper"
    attentive = True

    def choose(self, state, matter, event):
        def score(option: OptionDef) -> float:
            good, bad = outcome_shares(option)
            return good - bad
        if "canary" in [o.id for o in event.options]:
            return "canary"
        return max(event.options, key=score).id

    def verifies(self) -> bool:
        return True


STRATEGIES: dict[str, Callable[[int], Bot]] = {
    cls.name: cls for cls in (Cautious, Aggressive, RandomBot, IgnoreTheLaw, Silent, Paper)
}


def sitdown_command(bot: Bot, state: WorldState) -> SitDownAct:
    return SitDownAct(action=bot.sit(state))
