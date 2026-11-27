"""Enrich the base dashboard feed with cohort aggregates and per-individual
records, computed from the real model predictions joined to the deterministic
synthetic industrial workforce cohort attributes (seed 7, n=5800, validated to
match predictions 1:1 on actual absence hours).

The cohort / individual / HR-ops computation lives in feed_enrich.py and is
shared with the sector feed builder (build_sector_feeds.py). This script is the
base entry point: it reproduces the base cohort, joins it to the committed
predictions, and rewrites data/outputs/dashboard_feed.json / .js.
"""
from __future__ import annotations
import os, sys, json
import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from welo_pipeline.adapters.synthetic import SyntheticWorkforceAdapter
import demand
import departments
import feed_enrich
import staffing_cost

# How much of an absence has to be covered, by where it happens. A production
# line stops without its crew, so nearly every absence there buys cover;
# engineering and logistics can reschedule within the week; admin mostly
# waits. Illustrative, like every costing figure in this demo, and the
# screens say so.
INDUSTRIAL_ECONOMICS = {
    "cover_share_by_department": {
        "Production operations": 0.95,
        "Plant and processing": 0.92,
        "Engineering and maintenance": 0.60,
        "Logistics and materials": 0.65,
        "Site services": 0.55,
        "Support and admin": 0.25,
    },
}

# How busy each department is across a year, a month, a week and a day, and how
# expected absence moves against it.
#
# A benchmark pattern, not the tenant's data: no production, despatch or
# maintenance system is connected, and the block carries that sentence to the
# screen in `source`. The shapes are the ordinary rhythm of a continuous
# operation. Output runs flat through the year with a dip over the December
# shutdown and the January restart; month end is pushed to hit target; the
# working week is steady and the weekend is skeleton crews; the day has the
# two shift changes in it. Maintenance is the inverse of production, because
# the work happens when the plant is down, and admin keeps office hours.
#
# The absence multipliers are the winter respiratory season, the post-festive
# January, Monday, and the back of the night shift.
INDUSTRIAL_DEMAND = {
    "measure_label": "Production output and despatch volume",
    "source": "Benchmark pattern for the sector, not the tenant's data",
    "pattern": {
        "default": {
            "year": [72, 92, 96, 90, 94, 88, 90, 95, 97, 98, 100, 60],
            "month": [78, 84, 88, 90, 95, 100, 96],
            "week": [96, 100, 100, 98, 94, 55, 35],
            "day": [88, 100, 96, 80, 92, 95, 85, 70, 60],
        },
        "by_department": {
            # Shutdown and restart are when the plant can be worked on.
            "Engineering and maintenance": {
                "year": [100, 70, 65, 72, 68, 85, 88, 70, 66, 64, 70, 95],
                "week": [95, 100, 98, 95, 90, 70, 60],
            },
            # Despatch clears what the week produced, so it peaks late.
            "Logistics and materials": {
                "week": [70, 80, 88, 95, 100, 65, 30],
                "day": [60, 85, 95, 90, 100, 92, 70, 45, 30],
            },
            "Support and admin": {
                "week": [100, 100, 98, 95, 88, 15, 5],
                "day": [20, 85, 100, 95, 90, 75, 25, 10, 5],
            },
        },
    },
    "absence_multiplier": {
        "year": [1.12, 0.94, 0.95, 0.99, 1.02, 1.14, 1.18, 1.10, 0.96, 0.93, 0.95, 1.02],
        "month": [1.09, 0.98, 0.96, 0.96, 0.98, 1.06, 1.05],
        "week": [1.22, 0.96, 0.93, 0.95, 1.02, 1.05, 1.00],
        "day": [1.06, 0.98, 0.95, 0.97, 0.99, 1.02, 1.08, 1.14, 1.12],
    },
}

# The staffing-cost history: what was rostered, who was off, what cover cost
# and what each shift produced. Synthetic until a client's attendance, output
# and overtime data is connected; the method that estimates the loss never sees
# how the history was made, which is what lets the history check the method.
#
# The shape of the group is an inference from the cohort itself and published
# norms, not from any client. 5,800 people across four operations is about
# 1,450 each, which is a mid-size South African operation. Output value per
# operation is set so that a day's production is worth roughly what a day's
# labour costs several times over, which is what makes a short crew expensive;
# it is illustrative and is labelled as such wherever it is shown.
#
# `loss_elasticity` is how the synthetic history makes short shifts lose
# output. It is lower than hospitality's because a production line that is one
# or two people short slows rather than stops, where a short kitchen fails the
# service outright.
INDUSTRIAL_STAFFING = {
    "properties": 4,
    "staff_per_property": 1450,
    "history_end": "2026-10-31",
    "months": 24,
    "revenue_label": "Production output value",
    "revenue_per_property_annual_rand": 1_450_000_000,
    "price_growth_annual": 0.06,
    "loss_elasticity": 1.25,
    "services": [
        {"label": "Day shift", "revenue_share": 0.42},
        {"label": "Afternoon shift", "revenue_share": 0.34},
        {"label": "Night shift", "revenue_share": 0.24},
    ],
    # The departments whose staffing shows up in what a shift produces. A short
    # maintenance or admin shift costs something, but it does not show up in
    # the day's output, so it is counted and never priced.
    "revenue_departments": ["Production operations", "Plant and processing"],
    # Rostered to the production pattern; the rest keep their weekly rhythm.
    "seasonal_departments": ["Production operations", "Plant and processing", "Logistics and materials"],
    "department_shifts": {
        "Production operations": {"Day shift": 0.42, "Afternoon shift": 0.34, "Night shift": 0.24},
        "Plant and processing": {"Day shift": 0.38, "Afternoon shift": 0.34, "Night shift": 0.28},
        "Engineering and maintenance": {"Day shift": 0.55, "Afternoon shift": 0.25, "Night shift": 0.20},
        "Logistics and materials": {"Day shift": 0.50, "Afternoon shift": 0.35, "Night shift": 0.15},
        "Site services": {"Day shift": 0.60, "Afternoon shift": 0.40},
        "Support and admin": {"Day shift": 1.0},
    },
    # What a short shift does where it does not show up in output. Counted,
    # never priced: putting a rand figure on a deferred inspection would be a
    # guess dressed as a number. `basis` travels to the screen.
    "indicators": {
        "Engineering and maintenance": {
            "label": "Planned jobs deferred", "per_short_shift": 4,
            "basis": "An inference: no published norm for jobs per artisan shift",
        },
        "Logistics and materials": {
            "label": "Loads not moved", "per_short_shift": 3,
            "basis": "An inference, from a crew moving roughly a dozen loads a shift",
        },
        "Site services": {
            "label": "Service shifts run short", "per_short_shift": 1,
            "basis": "One per short shift",
        },
        "Support and admin": {
            "label": "Admin shifts run short", "per_short_shift": 1,
            "basis": "One per short shift",
        },
    },
}

# ---- load real model output + reproduce attributes -------------------------
preds = pd.read_csv(f"{ROOT}/data/outputs/predictions.csv")
syn = SyntheticWorkforceAdapter(n_rows=5800, random_seed=7,
                                cohort="sa_shift_workforce").load()
df = preds.merge(syn, on="employee_id", how="left", suffixes=("", "_attr"))
syn_mask = df["source_dataset"].str.startswith("synthetic").fillna(False)
df = df[syn_mask].copy()
assert (df["actual_absent_hours"].round() == df["absence_duration_hours"].round()).all()

# Where each person works. Derived from the work they already do rather than
# drawn fresh, because the predictions above are committed and this must not
# change them; see departments.py for why that is the honest option here and
# what it costs.
df["department"] = departments.assign(df)

# ---- enrich the committed base feed ----------------------------------------
feed = json.load(open(f"{ROOT}/data/outputs/dashboard_feed.json"))
feed, cohorts, individuals, n_hi, n_rest = feed_enrich.enrich(
    feed, df, sample_n=400, seed=7, economics=INDUSTRIAL_ECONOMICS
)

# The two blocks that only exist for a tenant with departments. Both return
# None without one, so this is a no-op for a cohort that has no department
# column rather than a branch to keep in step.
block = demand.build(feed, INDUSTRIAL_DEMAND)
if block:
    feed["demand"] = block
block = staffing_cost.build(
    feed, INDUSTRIAL_STAFFING, INDUSTRIAL_DEMAND,
    feed_enrich.resolve_economics(INDUSTRIAL_ECONOMICS),
)
if block:
    feed["staffing_cost"] = block

for d in feed_enrich.dimensions_for(df):
    print("\n==", d["label"], "==")
    for c in cohorts[d["key"]]:
        print(f"  {c['label']:>20}  n={c['count']:>4}  hi/crit={c['high_or_critical_share']*100:4.1f}%  "
              f"days/head/yr={c['absent_days_per_head_annual']:5.1f}  meanFatigue={c['mean_fatigue']}")
print("\nindividuals shipped:", len(individuals), "(High/Crit:", n_hi, "+ sample:", n_rest, ")")
hh = feed["hr_ops"]["headline"]
print(f"\nHR & Ops: absence rate {hh['absence_rate']*100:.1f}%  cover-gap {hh['cover_gap_days_90d']:,.0f}d  "
      f"RTW {hh['rtw_caseload']}  freq-trigger {hh['freq_trigger_count']}")

# ---- write enriched feed ----------------------------------------------------
out_json = f"{ROOT}/data/outputs/dashboard_feed.json"
json.dump(feed, open(out_json, "w"), indent=2, default=float)
js = ("// Auto-generated by welo_pipeline.export (+cohort/individual enrichment). Do not edit by hand.\n"
      "// Source: dashboard_feed.json\n"
      "window.WELO_FEED = " + json.dumps(feed, indent=2, default=float) + ";\n")
open(f"{ROOT}/data/outputs/dashboard_feed.js", "w").write(js)
print("\nwrote", out_json, os.path.getsize(out_json), "bytes")
