"""The staffing cost block: cover spend, estimated lost revenue, and value at
risk for the next 90 days.

The tests pin what makes the figures safe to show a buyer: the method recovers
a loss it was never told, the ranges are ranges, nothing is keyed by person,
and the departments whose short shifts do not show up in revenue are counted
rather than priced.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import build_sector_feeds  # noqa: E402
import staffing_cost  # noqa: E402

FEED_PATH = ROOT / "data" / "outputs" / "dashboard_feed.hospitality.json"
CONFIG = build_sector_feeds.SECTOR_STAFFING["hospitality"]
DEMAND = build_sector_feeds.SECTOR_DEMAND["hospitality"]
ECONOMICS = build_sector_feeds.SECTOR_ECONOMICS["hospitality"]

# Anything that could identify a person. The block is built from shifts and
# services, so none of these should appear anywhere in it, at any depth.
PERSON_KEYS = {
    "employee_id", "employee", "staff_id", "person", "person_id", "name",
    "first_name", "surname", "id_number", "email", "phone",
}


@pytest.fixture(scope="module")
def feed():
    return json.loads(FEED_PATH.read_text())


@pytest.fixture(scope="module")
def block(feed):
    return feed["staffing_cost"]


@pytest.fixture(scope="module")
def history(feed):
    return staffing_cost.generate_history(feed, CONFIG, DEMAND, ECONOMICS)


def _keys(node):
    if isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from _keys(v)
    elif isinstance(node, list):
        for v in node:
            yield from _keys(v)


def _ranges(node):
    if isinstance(node, dict):
        if set(node) == {"low", "mid", "high"}:
            yield node
        for v in node.values():
            yield from _ranges(v)
    elif isinstance(node, list):
        for v in node:
            yield from _ranges(v)


# --- What ships ---------------------------------------------------------------

def test_the_hospitality_feed_carries_the_block(block):
    for key in ["measure", "method", "assumptions", "history", "last_12_months",
                "by_department", "by_service", "forecast", "validation"]:
        assert key in block


def test_no_figure_is_keyed_by_person(block):
    found = {k.lower() for k in _keys(block)} & PERSON_KEYS
    assert not found, f"person keys in the staffing cost block: {sorted(found)}"


def test_the_shift_history_has_no_person_column(history):
    shifts, services = history
    assert not (set(shifts.columns) | set(services.columns)) & PERSON_KEYS


def test_every_range_is_ordered(block):
    ranges = list(_ranges(block))
    assert ranges
    for r in ranges:
        assert r["low"] <= r["mid"] <= r["high"], r


def test_the_history_is_24_contiguous_months(block):
    months = [m["month"] for m in block["history"]]
    assert len(months) == 24
    for a, b in zip(months[:-1], months[1:], strict=True):
        ya, ma = map(int, a.split("-"))
        yb, mb = map(int, b.split("-"))
        assert (yb * 12 + mb) - (ya * 12 + ma) == 1


def test_the_forecast_covers_the_next_90_days(block):
    f = block["forecast"]
    assert f["days"] == 90
    assert sum(m["days"] for m in f["months"]) == 90
    last = block["history"][-1]["month"]
    assert f["start"] > last


def test_value_at_risk_is_cover_plus_lost_revenue(block):
    t = block["forecast"]["total"]
    expected = t["cover_spend_rand"]["mid"] + t["lost_revenue_rand"]["mid"]
    assert t["value_at_risk_rand"]["mid"] == pytest.approx(expected, rel=0.05)


# --- Pricing ------------------------------------------------------------------

def test_cover_is_priced_at_the_feeds_own_rates(block, feed):
    rate = ECONOMICS["day_rate_rand"] + ECONOMICS["cover_premium_rand"]
    assert block["assumptions"]["cover_rate_per_shift_rand"] == rate
    assert feed["hr_ops"]["assumptions"]["day_rate_rand"] == block["assumptions"]["day_rate_rand"]
    for m in block["history"]:
        assert m["cover_spend_rand"] == pytest.approx(m["covered_shifts"] * rate)


def test_only_revenue_departments_are_priced(block):
    revenue = set(block["assumptions"]["revenue_departments"])
    for d in block["by_department"]:
        if d["label"] in revenue:
            assert d["priced"] and "lost_revenue_rand" in d
        else:
            assert not d["priced"] and "lost_revenue_rand" not in d
            assert d["indicator"]["unpriced"] is True


def test_suppressed_departments_are_left_out(feed):
    altered = json.loads(json.dumps(feed))
    rows = altered["cohorts"]["cohort_department"]
    rows[-1]["suppressed"] = True
    hidden = rows[-1]["label"]
    assert hidden not in staffing_cost._rates(altered)


def test_a_feed_without_departments_gets_no_block(feed):
    bare = {k: v for k, v in feed.items() if k != "cohorts"}
    assert staffing_cost.build(bare, CONFIG, DEMAND, ECONOMICS) is None


# --- The method ---------------------------------------------------------------

def test_the_method_never_reads_the_true_loss(history):
    _, services = history
    revenue_depts = CONFIG["revenue_departments"]
    with_truth, draws_a, _, _ = staffing_cost.estimate(services, revenue_depts)
    blind = services.drop(columns=["true_loss"])
    without_truth, draws_b, _, _ = staffing_cost.estimate(blind, revenue_depts)
    np.testing.assert_allclose(with_truth["loss"].to_numpy(), without_truth["loss"].to_numpy())
    np.testing.assert_allclose(draws_a, draws_b)


def test_the_method_recovers_the_loss_it_was_never_told(block):
    v = block["validation"]
    assert 0.95 <= v["recovered_share"] <= 1.05
    r = v["estimated_lost_revenue_rand"]
    assert r["low"] <= v["true_lost_revenue_rand"] <= r["high"]
    # An 80% range should hold the truth in most months, not all.
    assert v["months_true_within_range"] >= 0.6 * v["months"]


def test_it_holds_on_histories_it_was_never_tuned_on(feed):
    """One seed could be lucky. On fresh histories the estimate stays within
    10% of the truth, and an 80% range holds the truth most of the time."""
    inside = 0
    for seed in (202, 303, 707):
        _, services = staffing_cost.generate_history(feed, CONFIG, DEMAND, ECONOMICS, seed=seed)
        short, draws, _, _ = staffing_cost.estimate(services, CONFIG["revenue_departments"])
        truth = short["true_loss"].sum()
        total = draws.sum(axis=0)
        assert 0.90 <= np.median(total) / truth <= 1.10
        lo, hi = np.percentile(total, staffing_cost.RANGE)
        inside += int(lo <= truth <= hi)
    assert inside >= 2


def test_matching_on_measured_demand_would_have_understated_it(history):
    """Why comparators are picked on planned demand: measured demand is noisy,
    and picking on it favours over-measured services, which look less
    productive and shrink the estimated loss."""
    _, services = history
    revenue_depts = CONFIG["revenue_departments"]
    honest, draws, _, _ = staffing_cost.estimate(services, revenue_depts)
    noisy = services.copy()
    noisy["planned"] = noisy["demand"]
    naive, naive_draws, _, _ = staffing_cost.estimate(noisy, revenue_depts)
    truth_h = honest["true_loss"].sum()
    truth_n = naive["true_loss"].sum()
    assert abs(np.median(draws.sum(axis=0)) / truth_h - 1) < abs(np.median(naive_draws.sum(axis=0)) / truth_n - 1)
    assert np.median(naive_draws.sum(axis=0)) / truth_n < 0.97


def test_most_short_services_find_comparators(block):
    m = block["method"]
    total = m["matched_short_services"] + m["unmatched_short_services"]
    assert m["unmatched_short_services"] / total < 0.10
