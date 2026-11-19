"""Roster pattern features.

Four counts over the last 28 days that describe how a person was rostered,
rather than how many hours they worked. They are the same patterns the
platform's roster check flags (modules/absence/roster.js), so a manager who
fixes a flagged roster moves exactly these inputs, and the what-if engine can
price that fix.

- ``short_rest_count_28d``: times the gap between ending one shift and starting
  the next was under 12 hours (the BCEA daily rest).
- ``late_finish_share_28d``: share of shifts ending at or after 22:00, from 0 to 1.
- ``split_shifts_28d``: days worked as two blocks with a gap of 2 hours or more.
- ``short_notice_changes_28d``: shift changes made with under 48 hours notice.

Everything here is shared by the base generator, the sector generator, the
outcome series builder and the feature pipeline, so the four cannot drift
apart. The effect sizes are directional, like every synthetic knob: they say
a short rest adds a little fatigue, not how much it adds in any real
workforce. Real client data replaces them.

Missing roster data is neutral. A client extract without roster columns gets
the reference values below, which contribute nothing to fatigue, so the model
falls back to the hours-based picture rather than inventing a roster story.
"""

from __future__ import annotations

from typing import Dict, Optional

import numpy as np

ROSTER_FEATURES = [
    "short_rest_count_28d",
    "late_finish_share_28d",
    "split_shifts_28d",
    "short_notice_changes_28d",
]

# The roster features come from their own random stream, seeded off the
# generator's seed, so every draw that existed before them is unchanged.
SEED_OFFSET = 2027

# The reference roster: the typical heavy-industry pattern the base cohort was
# calibrated on. Fatigue contributions are measured against it, so the base
# cohort's average fatigue is where it was before roster features existed, and
# a missing value sits exactly here.
REFERENCE: Dict[str, float] = {
    "short_rest_count_28d": 1.5,
    "late_finish_share_28d": 0.20,
    "split_shifts_28d": 0.4,
    "short_notice_changes_28d": 1.0,
}

# Upper bounds, used for clipping draws, plausibility checks and lever clamps.
BOUNDS: Dict[str, tuple] = {
    "short_rest_count_28d": (0.0, 12.0),
    "late_finish_share_28d": (0.0, 1.0),
    "split_shifts_28d": (0.0, 12.0),
    "short_notice_changes_28d": (0.0, 10.0),
}

# Fatigue points per unit, and the most each can add.
_PER_SHORT_REST, _CAP_SHORT_REST = 2.0, 12.0
_PER_LATE_SHARE = 15.0
_PER_SPLIT, _CAP_SPLIT = 1.5, 9.0
_PER_NOTICE, _CAP_NOTICE = 1.0, 6.0

# How rosters are drawn for the base cohort. Sector profiles override these.
BASE_PROFILE: Dict[str, float] = {
    "short_rest_base": 0.9,     # Poisson rate before overtime pushes it up
    "late_share_mean": 0.20,
    "split_rate": 0.4,
    "short_notice_rate": 1.0,
}


def _raw_contribution(short_rest, late_share, split, notice):
    return (
        np.minimum(np.asarray(short_rest, dtype=float) * _PER_SHORT_REST, _CAP_SHORT_REST)
        + np.asarray(late_share, dtype=float) * _PER_LATE_SHARE
        + np.minimum(np.asarray(split, dtype=float) * _PER_SPLIT, _CAP_SPLIT)
        + np.minimum(np.asarray(notice, dtype=float) * _PER_NOTICE, _CAP_NOTICE)
    )


_REFERENCE_CONTRIBUTION = float(
    _raw_contribution(
        REFERENCE["short_rest_count_28d"],
        REFERENCE["late_finish_share_28d"],
        REFERENCE["split_shifts_28d"],
        REFERENCE["short_notice_changes_28d"],
    )
)


def fatigue_contribution(short_rest, late_share, split, notice):
    """Fatigue points the roster adds, relative to the reference roster.

    Positive for a worse roster than the reference, negative for a better one,
    zero at the reference. Arrays or scalars."""
    return _raw_contribution(short_rest, late_share, split, notice) - _REFERENCE_CONTRIBUTION


def draw(
    seed: int,
    overtime_14d: np.ndarray,
    profile: Optional[Dict[str, float]] = None,
    shifts: Optional[Dict[str, np.ndarray]] = None,
) -> Dict[str, np.ndarray]:
    """Draw the four roster features for a cohort.

    ``overtime_14d`` links short rests to overtime: people working more extra
    hours are the ones most often brought back in early. ``shifts`` holds
    optional per-person additive shifts (one array per profile key), which is
    how a department's pattern sits on top of its sector's.
    """
    p = {**BASE_PROFILE, **(profile or {})}
    rng = np.random.default_rng(int(seed) + SEED_OFFSET)
    n = len(overtime_14d)
    shifts = shifts or {}

    def knob(key):
        return p[key] + shifts.get(key, 0.0)

    short_rest_lam = np.clip(knob("short_rest_base") + np.asarray(overtime_14d) / 30.0, 0.05, None)
    short_rest = rng.poisson(short_rest_lam, size=n)

    # Beta with a fixed concentration, so the mean is the knob and the spread
    # is sensible: most people sit near their department's norm.
    late_mean = np.clip(knob("late_share_mean"), 0.02, 0.95)
    concentration = 8.0
    late_share = rng.beta(late_mean * concentration, (1.0 - late_mean) * concentration, size=n)

    split = rng.poisson(np.clip(knob("split_rate"), 0.05, None), size=n)
    notice = rng.poisson(np.clip(knob("short_notice_rate"), 0.05, None), size=n)

    lo_hi = BOUNDS
    return {
        "short_rest_count_28d": np.clip(short_rest, *lo_hi["short_rest_count_28d"]).astype(int),
        "late_finish_share_28d": np.clip(late_share, *lo_hi["late_finish_share_28d"]).round(2),
        "split_shifts_28d": np.clip(split, *lo_hi["split_shifts_28d"]).astype(int),
        "short_notice_changes_28d": np.clip(notice, *lo_hi["short_notice_changes_28d"]).astype(int),
    }
