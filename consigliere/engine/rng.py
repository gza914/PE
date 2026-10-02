"""The one seeded random generator. All randomness in the game goes through here."""

from __future__ import annotations

import random
from collections.abc import Sequence
from typing import Any, TypeVar

T = TypeVar("T")

# JSON-friendly form of random.Random.getstate(): [version, [625 ints], gauss_next]
RNGState = list[Any]


def fresh_seed() -> int:
    """A new seed for a new game, drawn from the OS."""
    return random.SystemRandom().randrange(2**32)


class GameRNG:
    def __init__(self, seed: int) -> None:
        self._random = random.Random(seed)

    def random(self) -> float:
        return self._random.random()

    def randint(self, low: int, high: int) -> int:
        """Inclusive on both ends."""
        return self._random.randint(low, high)

    def uniform(self, low: float, high: float) -> float:
        return self._random.uniform(low, high)

    def chance(self, probability: float) -> bool:
        return self._random.random() < probability

    def choice(self, items: Sequence[T]) -> T:
        return self._random.choice(items)

    def weighted_choice(self, items: Sequence[T], weights: Sequence[float]) -> T:
        return self._random.choices(items, weights=weights, k=1)[0]

    def get_state(self) -> RNGState:
        version, internal, gauss_next = self._random.getstate()
        return [version, list(internal), gauss_next]

    @classmethod
    def from_state(cls, state: RNGState) -> GameRNG:
        rng = cls(0)
        version, internal, gauss_next = state
        rng._random.setstate((version, tuple(internal), gauss_next))
        return rng
