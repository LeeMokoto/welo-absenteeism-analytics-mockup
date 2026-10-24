"""The time axis, and the monthly series built on it.

Two things under test. First, that the canonical schema's new required columns
are actually required: silently NA-filling a period was the old behaviour and it
would have produced an undated dataset that looks complete, with the problem
surfacing months later as an outcome report nobody can compute. Second, that the
series is the shape outcome tracking needs: monthly, complete, with cohort
membership frozen, and consistent with the data-generating process the model was
fitted on.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import build_outcome_series as bos  # noqa: E402
from welo_pipeline.adapters.base import (  # noqa: E402
    CANONICAL_COLUMNS,
    REQUIRED_COLUMNS,
    BaseAdapter,
)
from welo_pipeline.adapters.synthetic import SyntheticWorkforceAdapter  # noqa: E402
from welo_pipeline.adapters.uci import UCI_WINDOW_START  # noqa: E402

SERIES_PATH = ROOT / "data" / "outputs" / "cohort_series.json"


# --- The schema -------------------------------------------------------------


def test_canonical_schema_carries_the_time_axis_first():
    assert CANONICAL_COLUMNS[0] == "period_start"
    assert CANONICAL_COLUMNS[1] == "data_as_of"
    assert len(CANONICAL_COLUMNS) == 25


def test_the_required_columns_are_the_ones_that_cannot_be_imputed():
    assert set(REQUIRED_COLUMNS) == {
        "period_start",
        "data_as_of",
        "employee_id",
        "absence_duration_hours",
    }
    # And a column that genuinely can be imputed is not required, because
    # requiring everything would just move the problem.
    assert "height_cm" not in REQUIRED_COLUMNS


class _Stub(BaseAdapter):
    name = "stub"

    def __init__(self, df):
        super().__init__()
        self._df = df

    def load(self):
        return self._coerce_to_canonical(self._df.copy())


def _minimal(**over):
    base = {
        "period_start": ["2026-10-01"],
        "data_as_of": ["2026-10-01"],
        "employee_id": [1],
        "absence_duration_hours": [8.0],
    }
    base.update(over)
    return pd.DataFrame(base)


def test_an_extract_with_no_period_is_refused():
    df = _minimal().drop(columns=["period_start"])
    with pytest.raises(ValueError, match="missing required columns"):
        _Stub(df).load()


def test_an_extract_whose_period_is_entirely_empty_is_refused():
    """A column that looks like a time axis and carries nothing is worse than no
    column, because it passes every presence check."""
    df = _minimal(period_start=[None])
    with pytest.raises(ValueError, match="entirely empty"):
        _Stub(df).load()


def test_the_optional_columns_are_still_filled_rather_than_demanded():
    out = _Stub(_minimal()).load()
    assert list(out.columns) == CANONICAL_COLUMNS
    assert out["height_cm"].isna().all()


def test_the_refusal_says_why_the_period_matters():
    df = _minimal().drop(columns=["data_as_of"])
    with pytest.raises(ValueError) as err:
        _Stub(df).load()
    message = str(err.value)
    # A reader of this error has to be able to act on it.
    assert "time axis" in message
    assert "no change can be measured" in message


# --- The adapters supply a real period --------------------------------------


def test_the_synthetic_adapter_emits_one_dated_month():
    df = SyntheticWorkforceAdapter(n_rows=50, random_seed=7).load()
    assert df["period_start"].nunique() == 1
    assert df["data_as_of"].nunique() == 1
    pd.Timestamp(df["period_start"].iloc[0])  # parses, so it is a real date


def test_the_period_is_settable_because_a_series_is_a_walk_of_them():
    df = SyntheticWorkforceAdapter(n_rows=20, random_seed=7, period_start="2025-11-01").load()
    assert (df["period_start"] == "2025-11-01").all()


def test_the_uci_subset_is_dated_explicitly_rather_than_left_empty():
    """The UCI dataset has no usable date. The honest handling is an explicit
    window start with a label, not an empty column and not a guess."""
    assert UCI_WINDOW_START == "2007-07-01"


# --- The series -------------------------------------------------------------


@pytest.fixture(scope="module")
def series():
    if not SERIES_PATH.exists():
        pytest.skip("cohort_series.json not built; run build_outcome_series.py")
    return json.loads(SERIES_PATH.read_text())


def test_the_series_is_monthly_and_complete(series):
    assert series["period_grain"] == "month"
    assert len(series["periods"]) == 12
    for period in series["periods"]:
        assert period.endswith("-01"), f"{period} is not the first of a month"
    assert series["periods"] == sorted(series["periods"])


def test_every_cohort_either_carries_every_period_or_is_withheld(series):
    n_periods = len(series["periods"])
    for dim_key, dim in series["series"].items():
        for key, cohort in dim["cohorts"].items():
            if cohort["suppressed"]:
                assert cohort["periods"] == [], f"{dim_key}/{key} is suppressed and still has periods"
            else:
                assert len(cohort["periods"]) == n_periods, f"{dim_key}/{key} is ragged"


def test_cohort_membership_is_frozen(series):
    """The headcount cannot move between periods. If it did, the comparison
    would be of two different groups of people rather than of a before and an
    after, which is the failure mode this whole design exists to avoid."""
    for dim_key, dim in series["series"].items():
        for key, cohort in dim["cohorts"].items():
            counts = {p["count"] for p in cohort["periods"]}
            assert len(counts) <= 1, f"{dim_key}/{key} membership moved: {counts}"
            if cohort["periods"]:
                assert counts == {cohort["count"]}
                assert cohort["membership"] == "frozen at baseline"


def test_the_series_measures_actuals_and_says_so(series):
    assert "not model prediction" in series["measure_source"]
    assert series["measure"] == "absent_days_per_head_annual"


def test_the_series_carries_no_individual_records(series):
    blob = json.dumps(series)
    for banned in ("employee_id", "employee_key", "individuals"):
        assert f'"{banned}"' not in blob


def test_the_simulation_declares_itself(series):
    """A synthetic series that did not say it was simulated would be the single
    most misleading artefact in the repository."""
    assert series["synthetic"] is True
    sim = series["simulation"]
    assert "No outcome is written in by hand" in sim["mechanism"]
    assert "winter" in sim["seasonality"].lower()
    assert "does not claim a cause" in sim["caveat"]


def test_the_protected_dimension_keeps_its_raised_floor(series):
    age = series["series"]["cohort_age"]
    assert age["protected"] is True
    assert age["min_cohort"] == 10


# --- The series is consistent with the process the model was fitted on ------


def test_period_zero_is_close_to_the_adapter_baseline(series):
    """The series builder reproduces the adapter's absence process rather than
    importing it, because the adapter's copy is inline in `load`. This is the
    check that stops the two drifting apart silently: one month of drift should
    move the overall rate by a few percent, not transform it.
    """
    adapter = SyntheticWorkforceAdapter(
        n_rows=bos.N_ROWS, random_seed=bos.SEED, cohort="sa_shift_workforce"
    ).load()
    baseline_days_per_head = float(adapter["absence_duration_hours"].mean()) / 8.0 * 12

    load = series["series"]["cohort_load"]["cohorts"]
    first_total = sum(c["periods"][0]["absent_days_total"] for c in load.values() if c["periods"])
    first_n = sum(c["count"] for c in load.values() if c["periods"])
    series_days_per_head = first_total / first_n * 12

    assert series_days_per_head == pytest.approx(baseline_days_per_head, rel=0.15), (
        f"series period zero is {series_days_per_head:.1f} days per head against the adapter's "
        f"{baseline_days_per_head:.1f}. The two absence processes have drifted apart."
    )


def test_the_simulated_roster_change_moves_the_targeted_cohort_and_not_the_others(series):
    """The mechanism is simulated, not the outcome, so this asserts the
    mechanism had the effect the data-generating process implies: the targeted
    cohort falls, and the comparators do not."""
    dim = series["series"][bos.INTERVENTION_DIMENSION]["cohorts"]
    boundary = bos.INTERVENTION_PERIOD

    def change(cohort):
        pre = [p["absent_days_per_head_annual"] for p in cohort["periods"] if p["period_start"] < boundary]
        post = [p["absent_days_per_head_annual"] for p in cohort["periods"] if p["period_start"] >= boundary]
        return float(np.mean(post) - np.mean(pre))

    targeted = change(dim[bos.INTERVENTION_COHORT])
    others = [change(c) for k, c in dim.items() if k != bos.INTERVENTION_COHORT and c["periods"]]

    assert targeted < 0, f"the targeted cohort should fall, got {targeted:+.1f}"
    assert all(o > 0 for o in others), (
        f"the comparators should rise on the winter term alone, got {others}"
    )
    # Which is the case the demo exists to show: the raw before and after
    # understates the change, because winter lifted everybody.
    assert abs(targeted - float(np.mean(others))) > abs(targeted)


def test_the_winter_term_is_visible_in_every_cohort(series):
    """Seasonality has to hit the comparators too, or the comparator correction
    has nothing real to correct and the demo teaches the wrong lesson."""
    for dim in series["series"].values():
        for cohort in dim["cohorts"].values():
            if not cohort["periods"]:
                continue
            by_month = {p["period_start"][5:7]: p["absent_days_per_head_annual"] for p in cohort["periods"]}
            if "07" in by_month and "11" in by_month:
                assert by_month["07"] > by_month["11"], (
                    f"{cohort['label']}: July should read higher than November"
                )
