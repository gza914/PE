"""Month numbering. Month 0 is January 1958."""

START_YEAR = 1958
MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def year_of(month: int) -> int:
    return START_YEAR + month // 12


def month_label(month: int) -> str:
    return f"{MONTH_NAMES[month % 12]} {year_of(month)}"
