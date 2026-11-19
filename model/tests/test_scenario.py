"""Unit tests for the what-if scenario engine.

These are fully deterministic: they use a fake scorer, so no model, sklearn or
shap is needed. They pin the lever maths, the bounds/guardrails, cohort
filtering and the before/after aggregation.
"""

from __future__ import annotations

import pytest

from welo_inference import scenario


# --- a fake scorer: predicted days fall as overtime/workload fall -----------
def fake_score_fn(emps):
    out = []
    for e in emps:
        ot = float(e.get("overtime_hours_14d") or 0.0)
        sleep = float(e.get("sleep_hours_avg_7d") or 6.0)
        # simple monotonic surrogate for the real model
        monthly = max(0.0, 0.05 * ot + 2.0 * max(0.0, 6.5 - sleep))
        days90 = monthly * 3.0
        band = "high" if days90 > 3.0 else "low"
        out.append({
            "predicted_absent_days_90d": days90,
            "predicted_absent_days_monthly": monthly,
            "predicted_risk_band": band,
            "fatigue_burnout_score": 50.0,
        })
    return out


INDIVIDUALS = [
    {"attrs": {"overtime_hours_14d": 40.0, "sleep_hours_avg_7d": 6.0},
     "cohorts": {"cohort_load": "High-intensity ops"}},
    {"attrs": {"overtime_hours_14d": 20.0, "sleep_hours_avg_7d": 6.5},
     "cohorts": {"cohort_load": "High-intensity ops"}},
    {"attrs": {"overtime_hours_14d": 5.0, "sleep_hours_avg_7d": 7.0},
     "cohorts": {"cohort_load": "Light duty"}},
]


# --- apply_adjustments ------------------------------------------------------

def test_pct_lever_reduces_field():
    out = scenario.apply_adjustments({"overtime_hours_14d": 40.0}, {"overtime_pct": -20})
    assert out["overtime_hours_14d"] == pytest.approx(32.0)


def test_delta_lever_adds_and_clamps():
    out = scenario.apply_adjustments({"sleep_hours_avg_7d": 9.5}, {"sleep_delta": 3.0})
    assert out["sleep_hours_avg_7d"] == 10.0  # clamped to max


def test_set_lever_caps_only_downwards():
    # leave_gap_cap sets the field to min(current, value)
    below = scenario.apply_adjustments({"days_since_last_leave": 300}, {"leave_gap_cap": 120})
    above = scenario.apply_adjustments({"days_since_last_leave": 60}, {"leave_gap_cap": 120})
    assert below["days_since_last_leave"] == 120
    assert above["days_since_last_leave"] == 60


def test_missing_field_is_left_alone():
    out = scenario.apply_adjustments({"age": 40}, {"overtime_pct": -20})
    assert out == {"age": 40}


def test_unknown_lever_raises():
    with pytest.raises(scenario.ScenarioError):
        scenario.apply_adjustments({"overtime_hours_14d": 10}, {"nope": 1})


def test_out_of_range_lever_raises():
    with pytest.raises(scenario.ScenarioError):
        scenario.apply_adjustments({"overtime_hours_14d": 10}, {"overtime_pct": -500})


# --- cohort selection -------------------------------------------------------

def test_select_whole_workforce():
    assert len(scenario._select(INDIVIDUALS, None, None)) == 3


def test_select_by_cohort():
    picked = scenario._select(INDIVIDUALS, "cohort_load", "High-intensity ops")
    assert len(picked) == 2


def test_select_unknown_cohort_raises():
    with pytest.raises(scenario.ScenarioError):
        scenario._select(INDIVIDUALS, "cohort_load", "Does not exist")


# --- run_scenario end to end ------------------------------------------------

def test_run_scenario_delta_is_positive_when_lever_helps():
    r = scenario.run_scenario(fake_score_fn, INDIVIDUALS, {"overtime_pct": -50})
    assert r["cohort"]["covered_lives"] == 3
    assert r["baseline"]["predicted_absent_days_90d"] > r["scenario"]["predicted_absent_days_90d"]
    assert r["delta"]["predicted_absent_days_90d"] > 0
    assert 0 <= r["delta"]["days_saved_pct"] <= 100


def test_run_scenario_scoped_to_cohort():
    r = scenario.run_scenario(fake_score_fn, INDIVIDUALS, {"overtime_pct": -50},
                              "cohort_load", "High-intensity ops")
    assert r["cohort"]["covered_lives"] == 2


def test_run_scenario_empty_adjustments_raises():
    with pytest.raises(scenario.ScenarioError):
        scenario.run_scenario(fake_score_fn, INDIVIDUALS, {})


def test_levers_spec_shape():
    spec = scenario.levers_spec()
    names = {s["name"] for s in spec}
    assert {"overtime_pct", "sleep_delta", "leave_gap_cap"} <= names
    for s in spec:
        assert {"name", "label", "kind", "min", "max"} <= set(s)


# --- The day rate is the tenant's ----------------------------------------------

def test_savings_are_priced_at_the_rate_passed_in():
    """A hospitality day costs R650, not R1,100. Pricing a hospitality
    scenario at the industrial rate overstated every rand saving by 69%."""
    base = scenario.run_scenario(fake_score_fn, INDIVIDUALS, {"overtime_pct": -50})
    hosp = scenario.run_scenario(fake_score_fn, INDIVIDUALS, {"overtime_pct": -50},
                                 day_rate_rand=650.0)
    assert hosp["day_rate_rand"] == 650.0
    assert hosp["delta"]["predicted_absent_days_90d"] == base["delta"]["predicted_absent_days_90d"]
    assert hosp["delta"]["cost_saved_rand_annual"] == pytest.approx(
        base["delta"]["cost_saved_rand_annual"] * 650.0 / 1100.0, abs=1
    )
    assert hosp["baseline"]["cost_exposure_rand"] == pytest.approx(
        hosp["baseline"]["predicted_absent_days_annual"] * 650.0, rel=1e-3
    )


def test_without_a_rate_the_default_applies():
    r = scenario.run_scenario(fake_score_fn, INDIVIDUALS, {"overtime_pct": -50})
    assert r["day_rate_rand"] == scenario.RAND_PER_DAY


def test_the_rate_is_read_from_the_feed():
    feed = {"hr_ops": {"assumptions": {"day_rate_rand": 650.0}}}
    assert scenario.day_rate_from_feed(feed) == 650.0


@pytest.mark.parametrize("feed", [None, {}, {"hr_ops": {}}, {"hr_ops": {"assumptions": {}}},
                                  {"hr_ops": {"assumptions": {"day_rate_rand": 0}}},
                                  {"hr_ops": {"assumptions": {"day_rate_rand": "n/a"}}}])
def test_a_feed_without_a_usable_rate_falls_back(feed):
    assert scenario.day_rate_from_feed(feed) == scenario.RAND_PER_DAY


@pytest.mark.parametrize("name", ["hospitality", "manufacturing", "logistics"])
def test_every_committed_feed_records_the_rate_its_headline_uses(name):
    """The scenario reads the rate from the feed, so the feed's recorded rate
    must be the one its own headline was priced at."""
    import json
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "data" / "outputs" / f"dashboard_feed.{name}.json"
    feed = json.loads(path.read_text())
    h = feed["headline"]
    rate = scenario.day_rate_from_feed(feed)
    assert h["absence_cost_exposure_rand"] == pytest.approx(
        h["predicted_absent_days_annual"] * rate, rel=0.01
    )
