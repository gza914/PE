def clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))
