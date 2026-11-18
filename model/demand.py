"""
Demand set against expected absence, at four timescales.

Absence costs most when it lands on a busy period. This builds, for a tenant
with departments, how busy each department is across a year, a month, a week
and a day, beside how much of its staff is expected to be off at the same
points, so the platform can show where the two collide.

Two things here are not what they look like at first glance.

**Demand is a benchmark pattern, not the client's data.** No client trading
data is connected yet. The shapes are plausible patterns for the sector (a
December peak, payday weekends, Friday and Saturday nights, meal services) and
the block says so in `measure.source` and `measure.indicative`, which the
screen shows. When a client's till, booking or occupancy data arrives, it
replaces `pattern` and nothing downstream changes.

**Expected absence is the model's, spread over the calendar.** Each
department's modelled absence rate comes from the scored cohort. A seasonal
multiplier (winter illness, the post-festive January, Monday after the
weekend, early starts after late closes) spreads it across each timescale.
The multipliers are directional, like every hospitality value until the
calibration sources are agreed.

Demand is shown as a share of each department's own peak, because a kitchen and
a front desk do not count busyness in the same unit. Expected absence is a rate,
comparable across departments. They are different measures, so the screen draws
them as two charts on a shared timeline rather than one chart with two axes.

A pressure point is a period where demand is at least PRESSURE_DEMAND of its
peak and expected absence is above the department's own yearly average.
"""

from __future__ import annotations

WORK_DAYS_YR = 230
PRESSURE_DEMAND = 0.80

GRAINS = ["year", "month", "week", "day"]

LABELS = {
    "year": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "month": ["1-5", "6-10", "11-15", "16-20", "21-24", "25-28", "29-31"],
    "week": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    "day": ["06h", "08h", "10h", "12h", "14h", "16h", "18h", "20h", "22h"],
}

GRAIN_LABELS = {
    "year": "Month of the year",
    "month": "Days of the month",
    "week": "Day of the week",
    "day": "Time of day",
}


def _check(config):
    for grain in GRAINS:
        n = len(LABELS[grain])
        for name, series in [("absence multiplier", config["absence_multiplier"][grain]),
                             ("default demand", config["pattern"]["default"][grain])]:
            if len(series) != n:
                raise ValueError(f"{name} for {grain} has {len(series)} points, needs {n}")
        for dept, shapes in config["pattern"].get("by_department", {}).items():
            if grain in shapes and len(shapes[grain]) != n:
                raise ValueError(f"demand for {dept} {grain} has {len(shapes[grain])} points, needs {n}")


def build(feed: dict, config: dict) -> dict | None:
    """The demand block for a feed, or None if the feed has no departments.

    Departments suppressed in the feed's cohorts are left out entirely: a
    suppressed cohort's absence rate is exactly the figure suppression
    withholds.
    """
    rows = (feed.get("cohorts") or {}).get("cohort_department")
    if not rows:
        return None
    _check(config)

    shown = [r for r in rows if not r.get("suppressed") and r.get("absent_days_per_head_annual") is not None]
    total_heads = sum(r["count"] for r in shown)
    overall_rate = sum(r["absent_days_per_head_annual"] * r["count"] for r in shown) / total_heads / WORK_DAYS_YR

    def series(dept_label, rate):
        out = {}
        for grain in GRAINS:
            shape = (config["pattern"].get("by_department", {}).get(dept_label, {}).get(grain)
                     or config["pattern"]["default"][grain])
            peak = max(shape)
            demand = [round(v / peak, 3) for v in shape]
            mult = config["absence_multiplier"][grain]
            absence = [round(rate * m, 4) for m in mult]
            # Above the yearly average means a multiplier above one. Compared on
            # the multiplier, not the rounded rate, so rounding cannot tip a
            # period that sits exactly on the average into pressure.
            pressure = [d >= PRESSURE_DEMAND and m > 1.0 for d, m in zip(demand, mult, strict=True)]
            out[grain] = {"demand": demand, "absence_rate": absence, "pressure": pressure}
        return out

    departments = [
        {
            "label": r["label"],
            "count": r["count"],
            "absence_rate_annual": round(r["absent_days_per_head_annual"] / WORK_DAYS_YR, 4),
            "grains": series(r["label"], r["absent_days_per_head_annual"] / WORK_DAYS_YR),
        }
        for r in shown
    ]

    return {
        "measure": {
            "label": config["measure_label"],
            "source": config["source"],
            "indicative": True,
            "note": (
                "Demand is a benchmark pattern for the sector until the tenant's own trading data is connected. "
                "Expected absence is the model's rate for each department, spread across the calendar by a "
                "seasonal pattern. Both are illustrative."
            ),
        },
        "pressure_rule": {
            "demand_share_of_peak_at_least": PRESSURE_DEMAND,
            "absence_above": "the department's own yearly average",
        },
        "labels": LABELS,
        "grain_labels": GRAIN_LABELS,
        "overall": {
            "absence_rate_annual": round(overall_rate, 4),
            "grains": series(None, overall_rate),
        },
        "departments": departments,
        "withheld_departments": len(rows) - len(shown),
    }
