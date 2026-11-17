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
