"""Roster pattern features: short rests, late finishes, split shifts and
short-notice changes.

They exist so a roster fix can be priced. These tests pin the three things
that make that honest: the features are neutral when a client has no roster
data, they do not move the base cohort's calibration, and the sector and
department patterns point the way the profiles say they do.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import feed_enrich  # noqa: E402
import sector_cohorts  # noqa: E402
from welo_inference import scenario  # noqa: E402
from welo_pipeline import roster  # noqa: E402
from welo_pipeline.adapters.base import CANONICAL_COLUMNS  # noqa: E402
from welo_pipeline.adapters.synthetic import SyntheticWorkforceAdapter  # noqa: E402
from welo_pipeline.features import NUMERIC_FEATURES, _derive_fatigue_score  # noqa: E402
from welo_pipeline.validate import PLAUSIBILITY_RULES  # noqa: E402


def _contrib(df):
    return roster.fatigue_contribution(*(df[k].to_numpy() for k in roster.ROSTER_FEATURES))


@pytest.fixture(scope="module")
def base():
    return SyntheticWorkforceAdapter(n_rows=5800, random_seed=7).load()


@pytest.fixture(scope="module")
def hospitality():
    return sector_cohorts.generate_cohort("hospitality")


# --- The contribution -------------------------------------------------------

def test_the_reference_roster_adds_no_fatigue():
    ref = [roster.REFERENCE[k] for k in roster.ROSTER_FEATURES]
    assert float(roster.fatigue_contribution(*ref)) == pytest.approx(0.0)


@pytest.mark.parametrize("feature,worse", [
    ("short_rest_count_28d", 4),
    ("late_finish_share_28d", 0.6),
    ("split_shifts_28d", 3),
    ("short_notice_changes_28d", 4),
])
def test_each_pattern_adds_fatigue_when_it_gets_worse(feature, worse):
    values = dict(roster.REFERENCE)
    values[feature] = worse
    assert float(roster.fatigue_contribution(*(values[k] for k in roster.ROSTER_FEATURES))) > 0


def test_the_contribution_is_capped_so_one_pattern_cannot_run_away():
    extreme = dict(roster.REFERENCE, short_rest_count_28d=12)
    beyond = dict(roster.REFERENCE, short_rest_count_28d=28)
    a = float(roster.fatigue_contribution(*(extreme[k] for k in roster.ROSTER_FEATURES)))
    b = float(roster.fatigue_contribution(*(beyond[k] for k in roster.ROSTER_FEATURES)))
    assert a == b


# --- Calibration --------------------------------------------------------------

def test_the_base_cohort_keeps_its_fatigue_calibration(base):
    """Roster patterns spread fatigue out; they must not shift its average, or
    every number calibrated before them would move for no reason."""
    assert abs(float(_contrib(base).mean())) < 0.5


def test_the_roster_draw_has_its_own_stream():
    overtime = np.full(500, 19.0)
    a = roster.draw(7, overtime)
    b = roster.draw(7, overtime)
    c = roster.draw(8, overtime)
    assert all(np.array_equal(a[k], b[k]) for k in roster.ROSTER_FEATURES)
    assert not all(np.array_equal(a[k], c[k]) for k in roster.ROSTER_FEATURES)


def test_more_overtime_means_more_short_rests():
    low = roster.draw(7, np.full(4000, 5.0))["short_rest_count_28d"].mean()
    high = roster.draw(7, np.full(4000, 45.0))["short_rest_count_28d"].mean()
    assert high > low + 1.0


@pytest.mark.parametrize("cohort", ["base", "hospitality"])
def test_every_value_is_within_its_bounds(cohort, request):
    df = request.getfixturevalue(cohort)
    for k in roster.ROSTER_FEATURES:
        lo, hi = roster.BOUNDS[k]
        assert df[k].between(lo, hi).all(), k


# --- Sector and department patterns -----------------------------------------

def test_hospitality_rosters_are_worse_than_manufacturing(hospitality):
    manufacturing = sector_cohorts.generate_cohort("manufacturing")
    assert _contrib(hospitality).mean() > _contrib(manufacturing).mean() + 3


def test_the_floor_closes_late_and_housekeeping_does_not(hospitality):
    late = hospitality.groupby("department")["late_finish_share_28d"].mean()
    assert late["Front of house"] > late["Housekeeping"]
    assert late["Kitchen"] > late["Support and admin"]


def test_split_shifts_are_a_service_pattern(hospitality):
    split = hospitality.groupby("department")["split_shifts_28d"].mean()
    service = min(split["Kitchen"], split["Front of house"])
    assert service > max(split["Housekeeping"], split["Support and admin"])


# --- Missing data is neutral --------------------------------------------------

def test_an_extract_without_roster_columns_gets_the_reference_fatigue():
    row = {
        "sleep_hours_avg_7d": 6.0, "overtime_hours_14d": 20.0, "consecutive_shifts_worked": 7,
        "days_since_last_leave": 90, "workload_index_current": 230.0, "perceived_stress_score": 20,
    }
    without = _derive_fatigue_score(pd.DataFrame([row]))
    at_reference = _derive_fatigue_score(pd.DataFrame([{**row, **roster.REFERENCE}]))
    assert float(without.iloc[0]) == pytest.approx(float(at_reference.iloc[0]))


def test_a_worse_roster_raises_the_models_fatigue_score():
    row = {"sleep_hours_avg_7d": 6.0, "overtime_hours_14d": 20.0, **roster.REFERENCE}
    worse = {**row, "short_rest_count_28d": 5, "late_finish_share_28d": 0.6}
    scores = _derive_fatigue_score(pd.DataFrame([row, worse]))
    assert float(scores.iloc[1]) > float(scores.iloc[0])


# --- Wiring -------------------------------------------------------------------

def test_the_features_reach_every_stage():
    for k in roster.ROSTER_FEATURES:
        assert k in CANONICAL_COLUMNS
        assert k in NUMERIC_FEATURES
        assert k in PLAUSIBILITY_RULES
        assert k in feed_enrich.ATTR_COLS, "the scenario engine reads feed attrs"


def test_every_roster_feature_has_a_lever():
    fields = {spec["field"] for spec in scenario.LEVERS.values()}
    assert set(roster.ROSTER_FEATURES) <= fields


def test_removing_short_rests_stops_at_zero():
    out = scenario.apply_adjustments({"short_rest_count_28d": 3}, {"short_rest_delta": -12})
    assert out["short_rest_count_28d"] == 0


def test_halving_late_finishes_halves_the_share():
    out = scenario.apply_adjustments({"late_finish_share_28d": 0.4}, {"late_finish_pct": -50})
    assert out["late_finish_share_28d"] == pytest.approx(0.2)


def test_the_share_cannot_pass_one():
    out = scenario.apply_adjustments({"late_finish_share_28d": 0.8}, {"late_finish_pct": 100})
    assert out["late_finish_share_28d"] == 1.0
