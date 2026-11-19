"""Build sector dashboard feeds (manufacturing, logistics, hospitality).

Generates a sector-calibrated synthetic cohort, scores it with the SAME
persisted model as the base cohort (one model, different populations), then runs the
shared enrichment to produce data/outputs/dashboard_feed.<sector>.json / .js.
Global feature importance and model metrics are reused from the trained model,
since the model itself is unchanged; SHAP per-row reasons are omitted for the
sector cohorts, so the dashboard shows indicative drivers there.
"""
from __future__ import annotations

import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import demand
import feed_enrich
import sector_cohorts
import staffing_cost
from welo_pipeline.export import build_dashboard_feed
from welo_pipeline.features import build_features
from welo_pipeline.score import score

THRESHOLDS = {"low": 4, "medium": 16, "high": 40}  # from configs/demo.yaml

# Sector costing, where it differs from heavy industry. Illustrative and
# unsourced until the calibration sources are agreed (phase 0 of the
# hospitality plan): a lower loaded day rate, cover bought from casual and
# agency staff at a premium on that rate, and a higher share of absences that
# must be covered, because a short kitchen or floor slows the whole service.
# Sectors not listed use feed_enrich.DEFAULT_ECONOMICS and are unchanged.
SECTOR_ECONOMICS = {
    "hospitality": {
        "day_rate_rand": 650.0,
        "cover_premium_rand": 260.0,
        "cover_share_by_cohort": {"High-intensity ops": 0.95, "Standard ops": 0.85, "Light duty": 0.50},
        # A short kitchen or floor slows the whole service, so nearly every
        # absence there is covered; support work can mostly wait a day.
        "cover_share_by_department": {
            "Kitchen": 0.95, "Front of house": 0.85, "Housekeeping": 0.80,
            "Front office": 0.90, "Maintenance": 0.40, "Support and admin": 0.30,
        },
    },
}

# Demand patterns, for a sector whose tenants have departments. Benchmark
# shapes until a client's trading data is connected; see demand.py. Kitchen and
# front of house follow the meal services, so they take the default day shape;
# housekeeping peaks on turnarounds after checkout, front office on check-in and
# check-out, maintenance and support on office hours.
SECTOR_DEMAND = {
    "hospitality": {
        "measure_label": "Covers, occupied rooms and service volume",
        "source": "Benchmark pattern for the sector, not the tenant's data",
        "pattern": {
            "default": {
                "year": [95, 70, 78, 88, 65, 68, 82, 66, 75, 78, 85, 100],
                "month": [72, 62, 60, 64, 72, 98, 90],
                "week": [50, 55, 62, 70, 92, 100, 80],
                "day": [55, 70, 40, 90, 50, 45, 85, 100, 60],
            },
            "by_department": {
                "Housekeeping": {"week": [85, 60, 62, 65, 75, 90, 100], "day": [20, 45, 95, 100, 85, 50, 20, 10, 5]},
                "Front office": {"day": [60, 90, 70, 55, 85, 95, 70, 50, 30]},
                "Maintenance": {"week": [90, 100, 100, 95, 90, 40, 30], "day": [30, 70, 90, 85, 80, 60, 30, 20, 15]},
                "Support and admin": {"week": [95, 100, 100, 98, 90, 20, 10], "day": [10, 80, 100, 95, 90, 70, 15, 5, 5]},
            },
        },
        # How expected absence moves through each timescale, around the
        # department's own rate: winter illness and the post-festive January,
        # the payday weekend, Monday, and early starts after late closes.
        "absence_multiplier": {
            "year": [1.10, 0.92, 0.94, 0.98, 1.00, 1.12, 1.15, 1.08, 0.95, 0.93, 0.96, 1.08],
            "month": [1.08, 0.97, 0.95, 0.96, 0.99, 1.10, 1.06],
            "week": [1.20, 0.95, 0.92, 0.96, 1.04, 1.06, 1.00],
            "day": [1.15, 1.05, 0.95, 0.97, 0.95, 1.00, 1.03, 1.06, 1.04],
        },
    },
}

# The staffing cost history, for a sector whose departments earn revenue by
# service. Synthetic until a client's attendance, trading and agency invoice
# data is connected; see staffing_cost.py. Group revenue, property count and
# the shape of each department's shifts are illustrative. `loss_elasticity`
# is how the synthetic history makes short services lose revenue; the method
# that estimates the loss never sees it, which is what lets the history check
# the method.
SECTOR_STAFFING = {
    "hospitality": {
        "properties": 8,
        "staff_per_property": 750,
        "history_end": "2026-10-31",
        "months": 24,
        "revenue_label": "Food and beverage revenue",
        "revenue_per_property_annual_rand": 95_000_000,
        "price_growth_annual": 0.06,
        "loss_elasticity": 1.6,
        "services": [
            {"label": "Breakfast", "revenue_share": 0.18},
            {"label": "Lunch", "revenue_share": 0.32},
            {"label": "Dinner", "revenue_share": 0.50},
        ],
        # Departments whose staffing shows up in what a service takes.
        "revenue_departments": ["Kitchen", "Front of house"],
        # Departments rostered to guest demand; the rest keep their weekly rhythm.
        "seasonal_departments": ["Kitchen", "Front of house", "Housekeeping", "Front office"],
        # Each department's shifts, as shares of its daily rostered shifts.
        "department_shifts": {
            "Kitchen": {"Breakfast": 0.24, "Lunch": 0.33, "Dinner": 0.43},
            "Front of house": {"Breakfast": 0.22, "Lunch": 0.33, "Dinner": 0.45},
            "Housekeeping": {"Morning": 0.75, "Afternoon": 0.25},
            "Front office": {"Morning": 0.40, "Evening": 0.40, "Night": 0.20},
            "Maintenance": {"Day": 1.0},
            "Support and admin": {"Day": 1.0},
        },
        # What a short shift does where it does not show up in revenue. Counted,
        # never priced.
        "indicators": {
            "Housekeeping": {"label": "Rooms turned late", "per_short_shift": 14},
            "Front office": {"label": "Front desk shifts run short", "per_short_shift": 1},
            "Maintenance": {"label": "Jobs deferred", "per_short_shift": 6},
            "Support and admin": {"label": "Admin shifts run short", "per_short_shift": 1},
        },
    },
}

# Same benchmark share of exposure as welo_pipeline.export uses for the
# headline saving, so only the day rate changes between sectors.
HEADLINE_ADDRESSABLE_SHARE = 0.042


def reprice_headline(feed: dict, day_rate: float) -> None:
    """Restate the headline cost at a sector's own day rate.

    welo_pipeline.export prices the headline at the heavy-industry rate. A
    sector with its own rate has to restate it, or the portfolio screen would
    show one rate in the headline and another in the cohorts underneath it.
    """
    h = feed["headline"]
    exposure = round(h["predicted_absent_days_annual"] * day_rate, 0)
    h["absence_cost_exposure_rand"] = exposure
    h["projected_addressable_saving_rand"] = round(exposure * HEADLINE_ADDRESSABLE_SHARE, 0)
MODELS_DIR = f"{ROOT}/models"

# Reuse the trained model's global importance + metrics (model is unchanged).
_base = json.load(open(f"{ROOT}/data/outputs/dashboard_feed.json"))
GLOBAL_IMPORTANCE = pd.DataFrame(_base["global_feature_importance"])
METRICS = json.load(open(f"{ROOT}/reports/model_metrics.json"))


def build_sector(sector: str) -> dict:
    cohort = sector_cohorts.generate_cohort(sector, n_rows=6000, random_seed=7)
    bundle = build_features(cohort, THRESHOLDS)
    pred = score(bundle, models_dir=MODELS_DIR)

    explanations = {"global_importance": GLOBAL_IMPORTANCE, "per_row_reasons": {}}
    feed = build_dashboard_feed(pred, METRICS, explanations, run_name=f"welo_{sector}_v1")
    economics = SECTOR_ECONOMICS.get(sector)
    if economics:
        reprice_headline(feed, economics["day_rate_rand"])

    # join predictions to cohort attributes for the cohort/individual views
    df = pred.merge(cohort, on="employee_id", how="left", suffixes=("", "_attr"))
    feed, cohorts, individuals, n_hi, n_rest = feed_enrich.enrich(
        feed, df, sample_n=400, seed=7, economics=economics)
    if sector in SECTOR_DEMAND:
        block = demand.build(feed, SECTOR_DEMAND[sector])
        if block:
            feed["demand"] = block
    if sector in SECTOR_STAFFING and sector in SECTOR_DEMAND:
        block = staffing_cost.build(feed, SECTOR_STAFFING[sector], SECTOR_DEMAND[sector], economics)
        if block:
            feed["staffing_cost"] = block

    out_json = f"{ROOT}/data/outputs/dashboard_feed.{sector}.json"
    json.dump(feed, open(out_json, "w"), indent=2, default=float)
    js = ("// Auto-generated by build_sector_feeds.py. Do not edit by hand.\n"
          f"// Sector: {sector}\n"
          "window.WELO_FEED = " + json.dumps(feed, indent=2, default=float) + ";\n")
    open(f"{ROOT}/data/outputs/dashboard_feed.{sector}.js", "w").write(js)

    hh = feed["hr_ops"]["headline"]
    h = feed["headline"]
    print(f"\n=== {sector} ===")
    print(f"  covered lives: {h['covered_lives']}  predicted absent days 90d: {h['predicted_absent_days_90d']:,.0f}")
    print(f"  absence rate: {hh['absence_rate']*100:.1f}%  fatigue high/crit: {h['fatigue_high_or_critical_share']*100:.1f}%")
    rd = {b['band']: b['share'] for b in feed['risk_distribution']}
    print("  risk dist: " + "  ".join(f"{k}={v*100:.1f}%" for k, v in rd.items()))
    for d in feed_enrich.DIMENSIONS:
        if d["key"] != "cohort_lifestyle":
            continue
        for c in cohorts[d["key"]]:
            print(f"    {c['label']:>20}  n={c['count']:>4}  hi/crit={c['high_or_critical_share']*100:4.1f}%  "
                  f"days/head/yr={c['absent_days_per_head_annual']:5.1f}")
    print(f"  individuals shipped: {len(individuals)} (High/Crit {n_hi} + sample {n_rest})")
    return feed


if __name__ == "__main__":
    for s in ["manufacturing", "logistics", "hospitality"]:
        build_sector(s)
    print("\ndone.")
