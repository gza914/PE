from consigliere.engine.content import balance


def tuned(**sections):
    """A deep copy of the real balance with some fields overridden, e.g. tuned(loyalty={"noise": 0})."""
    bal = balance().model_copy(deep=True)
    for section, fields in sections.items():
        part = getattr(bal, section)
        for name, value in fields.items():
            setattr(part, name, value)
    return bal
