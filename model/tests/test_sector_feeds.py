"""
Sector feeds: the hospitality cohort and per-sector cover economics.

Hospitality is the first sector outside heavy industry, and the first whose
costing differs: a lower day rate, cover bought from casual and agency staff,
and more absences that must be covered. These tests hold three things:

1. The hospitality cohort is the population it claims to be (younger, more
   female, shorter tenure, less sleep) and is tagged so it can be filtered out.
2. The economics parameter changes only the sector that passes it. Every other
   feed keeps the heavy-industry defaults, so adding a sector cannot quietly
   reprice the ones already in front of buyers.
3. The committed hospitality feed is priced at its own rate everywhere it shows
   a Rand figure: headline, cohorts and the HR cover block agree.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import feed_enrich  # noqa: E402
import sector_cohorts  # noqa: E402

OUTPUTS = ROOT / "data" / "outputs"
HOSPITALITY_ECONOMICS = {
    "day_rate_rand": 650.0,
    "cover_premium_rand": 260.0,
    "cover_share_by_cohort": {"High-intensity ops": 0.95, "Standard ops": 0.85, "Light duty": 0.50},
}


def _feed(sector: str) -> dict:
    return json.loads((OUTPUTS / f"dashboard_feed.{sector}.json").read_text())


# 1. The cohort -------------------------------------------------------------

@pytest.fixture(scope="module")
def hospitality():
    return sector_cohorts.generate_cohort("hospitality", n_rows=6000, random_seed=7)


@pytest.fixture(scope="module")
def manufacturing():
    return sector_cohorts.generate_cohort("manufacturing", n_rows=6000, random_seed=7)


def test_hospitality_rows_are_tagged_synthetic(hospitality):
    assert len(hospitality) == 6000
    assert set(hospitality["source_dataset"]) == {"synthetic_hospitality_sa"}


def test_hospitality_ids_do_not_collide_with_other_sectors(hospitality, manufacturing):
    assert set(hospitality["employee_id"]).isdisjoint(set(manufacturing["employee_id"]))


def test_hospitality_is_the_population_it_claims_to_be(hospitality, manufacturing):
    assert hospitality["age"].mean() < manufacturing["age"].mean() - 5
    assert (hospitality["gender"] == "F").mean() > 0.45
    assert hospitality["tenure_years"].median() < manufacturing["tenure_years"].median()
    assert hospitality["sleep_hours_avg_7d"].mean() < manufacturing["sleep_hours_avg_7d"].mean()
    assert hospitality["consecutive_shifts_worked"].mean() > manufacturing["consecutive_shifts_worked"].mean()


def test_hospitality_cohort_is_reproducible():
    a = sector_cohorts.generate_cohort("hospitality", n_rows=200, random_seed=7)
    b = sector_cohorts.generate_cohort("hospitality", n_rows=200, random_seed=7)
    assert a.equals(b)


# 2. Economics only change the sector that passes them ---------------------

def test_defaults_are_the_heavy_industry_values():
    econ = feed_enrich.resolve_economics()
    assert econ["day_rate_rand"] == feed_enrich.RAND_PER_DAY
    assert econ["cover_premium_rand"] == feed_enrich.COVER_PREMIUM
    assert econ["cover_share_by_cohort"] == feed_enrich.COVER_SHARE


def test_a_partial_block_falls_back_to_defaults():
    econ = feed_enrich.resolve_economics({"day_rate_rand": 500.0})
    assert econ["day_rate_rand"] == 500.0
    assert econ["cover_premium_rand"] == feed_enrich.COVER_PREMIUM


@pytest.mark.parametrize("sector", ["manufacturing", "logistics"])
def test_heavy_industry_sectors_keep_the_default_pricing(sector):
    a = _feed(sector)["hr_ops"]["assumptions"]
    assert a["day_rate_rand"] == feed_enrich.RAND_PER_DAY
    assert a["cover_premium_rand"] == feed_enrich.COVER_PREMIUM
    assert a["cover_share_by_cohort"] == feed_enrich.COVER_SHARE


# 3. The hospitality feed agrees with itself --------------------------------

@pytest.fixture(scope="module")
def hospitality_feed():
    path = OUTPUTS / "dashboard_feed.hospitality.json"
    if not path.exists():
        pytest.skip("hospitality feed not built; run python build_sector_feeds.py")
    return json.loads(path.read_text())


def test_feed_carries_the_hospitality_assumptions(hospitality_feed):
    a = hospitality_feed["hr_ops"]["assumptions"]
    assert a["day_rate_rand"] == HOSPITALITY_ECONOMICS["day_rate_rand"]
    assert a["cover_premium_rand"] == HOSPITALITY_ECONOMICS["cover_premium_rand"]
    assert a["cover_share_by_cohort"] == HOSPITALITY_ECONOMICS["cover_share_by_cohort"]


def test_headline_is_priced_at_the_hospitality_rate(hospitality_feed):
    h = hospitality_feed["headline"]
    expected = round(h["predicted_absent_days_annual"] * HOSPITALITY_ECONOMICS["day_rate_rand"], 0)
    assert h["absence_cost_exposure_rand"] == pytest.approx(expected, abs=1)


def test_cohorts_are_priced_at_the_hospitality_rate(hospitality_feed):
    rate = HOSPITALITY_ECONOMICS["day_rate_rand"]
    for rows in hospitality_feed["cohorts"].values():
        for row in rows:
            if row.get("suppressed"):
                continue
            # Days are rounded in the feed and cost is not, so allow one day.
            expected = row["predicted_absent_days_annual"] * rate
            assert row["cost_exposure_rand"] == pytest.approx(expected, abs=rate)


def test_cover_cost_uses_casual_and_agency_rates(hospitality_feed):
    cover_day = HOSPITALITY_ECONOMICS["day_rate_rand"] + HOSPITALITY_ECONOMICS["cover_premium_rand"]
    hh = hospitality_feed["hr_ops"]["headline"]
    # The cover gap is rounded to whole days in the feed, so allow one cover-day.
    assert hh["backfill_cost_rand_90d"] == pytest.approx(hh["cover_gap_days_90d"] * cover_day, abs=cover_day)


def test_hospitality_feed_is_marked_synthetic(hospitality_feed):
    assert hospitality_feed["synthetic"] is True


# 4. Departments -------------------------------------------------------------

def test_hospitality_has_departments_and_heavy_industry_does_not(hospitality, manufacturing):
    assert "department" in hospitality.columns
    assert "department" not in manufacturing.columns
    shares = hospitality["department"].value_counts(normalize=True)
    assert set(shares.index) == {"Kitchen", "Front of house", "Housekeeping", "Front office", "Maintenance", "Support and admin"}
    assert shares.min() > 0.03


def test_departments_do_not_disturb_the_base_draws(hospitality):
    # Departments come from their own random stream, so the draws they do not
    # shift (age, tenure, BMI) are the ones a cohort without them would get.
    profile = dict(sector_cohorts.SECTOR_PROFILES["hospitality"])
    profile.pop("departments")
    sector_cohorts.SECTOR_PROFILES["_hospitality_without_departments"] = profile
    try:
        plain = sector_cohorts.generate_cohort("_hospitality_without_departments", n_rows=6000, random_seed=7)
    finally:
        del sector_cohorts.SECTOR_PROFILES["_hospitality_without_departments"]
    for col in ["age", "tenure_years", "bmi", "smoking_status"]:
        assert plain[col].equals(hospitality[col]), col


def test_kitchen_runs_hotter_than_support(hospitality):
    by = hospitality.groupby("department")
    assert by["workload_index_current"].mean()["Kitchen"] > by["workload_index_current"].mean()["Support and admin"]
    assert by["sleep_hours_avg_7d"].mean()["Kitchen"] < by["sleep_hours_avg_7d"].mean()["Support and admin"]


def test_department_grouping_appears_only_where_the_data_has_it(hospitality_feed):
    keys = [d["key"] for d in hospitality_feed["cohort_dimensions"]]
    assert keys[-1] == "cohort_department"
    for sector in ["manufacturing", "logistics"]:
        assert "cohort_department" not in [d["key"] for d in _feed(sector)["cohort_dimensions"]]
        assert "by_department" not in _feed(sector)["hr_ops"]


def test_cover_is_priced_by_department_in_hospitality(hospitality_feed):
    hr = hospitality_feed["hr_ops"]
    assert hr["assumptions"]["cover_share_by_department"]["Kitchen"] == 0.95
    labels = [r["label"] for r in hr["by_department"]]
    assert "Kitchen" in labels
    total = sum(r["cover_gap_days_90d"] for r in hr["by_department"] if not r.get("suppressed"))
    assert total == pytest.approx(hr["headline"]["cover_gap_days_90d"], rel=0.01)


def test_hospitality_series_carries_departments():
    path = OUTPUTS / "cohort_series.hospitality.json"
    if not path.exists():
        pytest.skip("hospitality series not built; run python build_outcome_series.py hospitality")
    series = json.loads(path.read_text())["series"]
    assert "cohort_department" in series
    assert "Kitchen" in series["cohort_department"]["cohorts"]


# 5. Demand -------------------------------------------------------------------

import demand  # noqa: E402


def test_demand_appears_only_for_a_tenant_with_departments(hospitality_feed):
    assert "demand" in hospitality_feed
    for sector in ["manufacturing", "logistics"]:
        assert "demand" not in _feed(sector)


def test_demand_departments_match_the_reported_departments(hospitality_feed):
    reported = [r["label"] for r in hospitality_feed["cohorts"]["cohort_department"] if not r.get("suppressed")]
    assert [d["label"] for d in hospitality_feed["demand"]["departments"]] == reported


def test_a_suppressed_department_is_left_out_of_demand():
    feed = {"cohorts": {"cohort_department": [
        {"label": "A", "count": 400, "absent_days_per_head_annual": 12.0},
        {"label": "B", "count": None, "suppressed": True},
    ]}}
    from build_sector_feeds import SECTOR_DEMAND
    block = demand.build(feed, SECTOR_DEMAND["hospitality"])
    assert [d["label"] for d in block["departments"]] == ["A"]
    assert block["withheld_departments"] == 1


def test_a_period_exactly_at_the_average_is_not_pressure(hospitality_feed):
    # Sunday's multiplier is exactly one; rounding once tipped it into pressure.
    week = hospitality_feed["demand"]["overall"]["grains"]["week"]
    sunday = hospitality_feed["demand"]["labels"]["week"].index("Sun")
    assert week["pressure"][sunday] is False


def test_a_pattern_of_the_wrong_length_is_refused():
    from build_sector_feeds import SECTOR_DEMAND
    broken = {**SECTOR_DEMAND["hospitality"], "absence_multiplier": {**SECTOR_DEMAND["hospitality"]["absence_multiplier"], "week": [1.0] * 6}}
    with pytest.raises(ValueError, match="week"):
        demand.build({"cohorts": {"cohort_department": [{"label": "A", "count": 10, "absent_days_per_head_annual": 5}]}}, broken)
