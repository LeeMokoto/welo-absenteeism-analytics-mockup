"""Monthly cohort series, for outcome tracking.

The canonical extract was 23 scalar columns, one row per employee, with no
date. That is enough to target a cohort and not enough to say whether anything
changed, because measuring change needs the same group at two points in time.
This script produces the time axis the platform was missing: one row per cohort
per month, with `period_start` and `data_as_of`.

Three decisions are baked in here rather than left to the reader.

**The measure is actual absence, not predicted absence.** The model targets; the
actuals measure. Measuring an intervention with the model that selected the
cohort for it would be measuring our own prediction, and it would report a
success whenever the model happened to revise its view. So nothing in this file
loads the model. It counts.

**Cohort membership freezes at the baseline period.** `cohort_load` is banded on
within-period z-scores, so a roster change that lowers overtime across the
targeted cohort would re-band those people out of "High-intensity ops" and the
cohort measured in month 9 would be a different set of people than the cohort
the intervention named. The group is fixed at baseline and followed, which is
the only way the comparison is of a before and an after rather than of two
different groups.

**Suppression is evaluated per period and enforced across the series.** A cohort
visible in one month and suppressed in the next leaks the suppressed count
through the difference, so the series builder marks the whole series withheld if
any period in it falls below the floor. See `SERIES_SUPPRESSED` below.

On the synthetic data, precisely, because this is the part that would be easy to
oversell: the intervention is simulated **mechanistically**, not by its outcome.
From `INTERVENTION_PERIOD` the targeted cohort's overtime and consecutive shifts
really do fall, which is what a roster change does, and the absence that follows
is whatever the data-generating process produces from those inputs. Nothing
writes an improvement in by hand. A winter term is layered on every cohort,
because South African absence rises June to August for reasons that are not in
the feature set at all, and it is there on purpose: it makes the raw before and
after of the targeted cohort look *worse* than it is, so the comparator
correction has something real to correct. On a client's data you would not know
the mechanism, and the platform is written to report an observed difference
rather than a cause.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import feed_enrich  # noqa: E402
from welo_pipeline.adapters.synthetic import SyntheticWorkforceAdapter  # noqa: E402

N_ROWS = 5800
SEED = 7

# Twelve monthly periods. A month is the period because that is the cadence an
# employer's HR system can actually produce without a new integration, and
# because a shorter period on a cohort of this size puts half the cells under
# the suppression floor.
PERIODS = pd.date_range("2025-11-01", periods=12, freq="MS").strftime("%Y-%m-%d").tolist()

# The month the simulated roster change starts. Deliberately placed so that the
# winter band falls inside the post-intervention window: the raw comparison is
# then misleading in the direction that flatters nobody, which is the case worth
# showing.
INTERVENTION_PERIOD = "2026-04-01"
INTERVENTION_DIMENSION = "cohort_load"
INTERVENTION_COHORT = "High-intensity ops"

# Winter multiplier on absence, by calendar month. Infection-driven, so it moves
# absence without moving any feature the model sees, which is exactly why a
# before-and-after on the targeted cohort alone cannot be trusted.
WINTER = {6: 1.22, 7: 1.30, 8: 1.18, 5: 1.06, 9: 1.05}

HOURS_PER_DAY = 8.0
WORK_DAYS_PER_MONTH = 21.7


def _fatigue(sleep, overtime, shifts, leave_gap, workload, noise):
    """The adapter's fatigue composite, which is what generated the absence the
    model was fitted on. Reproduced rather than imported because it is inline in
    the adapter's `load`; `test_outcome_series.py` asserts that period zero with
    no drift reproduces the adapter's own baseline, so the two cannot drift
    apart silently."""
    sleep_deficit = np.clip(6.5 - sleep, 0, None)
    return np.clip(
        18.0
        + sleep_deficit * 6.5
        + np.minimum(overtime / 40.0 * 25.0, 25.0)
        + np.minimum(shifts / 14.0 * 15.0, 15.0)
        + np.minimum(leave_gap / 180.0 * 15.0, 15.0)
        + np.clip((workload - 240) / 5.0, 0, 20)
        + noise,
        0,
        100,
    )


def _absence_hours(base, fatigue, workload, rng):
    """The adapter's absence process, with fatigue and workload as the only
    time-varying terms. `base` holds the parts that do not change month to
    month: body, age, lifestyle, commute, dependents."""
    workload_z = (workload - 220) / 45.0
    fatigue_z = (fatigue - 50) / 18.0
    latent = base + 0.5 * workload_z + 1.1 * fatigue_z
    mu = np.exp(latent / 1.5 + rng.normal(0, 0.55, size=len(fatigue)))
    hours = np.clip(mu, 0, 120)
    # The same share of people with no absence at all in a period.
    return np.where(rng.random(len(hours)) < 0.18, 0.0, hours)


def build():
    adapter = SyntheticWorkforceAdapter(
        n_rows=N_ROWS, random_seed=SEED, cohort="sa_shift_workforce"
    )
    base_df = adapter.load().reset_index(drop=True)

    # --- Freeze cohort membership at baseline -------------------------------
    # add_cohort_columns needs a fatigue band, which the adapter does not emit.
    # Derive it here with the pipeline's own edges so the bands line up with
    # what the dashboard shows.
    rng0 = np.random.default_rng(SEED)
    fatigue0 = _fatigue(
        base_df["sleep_hours_avg_7d"].to_numpy(),
        base_df["overtime_hours_14d"].to_numpy(),
        base_df["consecutive_shifts_worked"].to_numpy(),
        base_df["days_since_last_leave"].to_numpy(),
        base_df["workload_index_current"].to_numpy(),
        rng0.normal(0, 6.0, len(base_df)),
    )
    base_df["fatigue_burnout_score"] = fatigue0.round(1)
    base_df["fatigue_band"] = pd.cut(
        base_df["fatigue_burnout_score"],
        bins=[-0.01, 30, 50, 70, 101],
        labels=["low", "moderate", "high", "critical"],
        right=False,
    ).astype(str)

    frozen = feed_enrich.add_cohort_columns(base_df.copy())
    cohort_cols = {d["key"]: frozen[d["key"]].to_numpy() for d in feed_enrich.DIMENSIONS}

    # The static half of the absence process, computed once.
    bmi_z = (base_df["bmi"].to_numpy() - 27.4) / 4.6
    age_z = (base_df["age"].to_numpy() - 38) / 9.0
    smoke = base_df["smoking_status"].map(
        {"Never": 0.0, "Former": 0.4, "Occasional": 1.0, "Daily": 2.1}
    ).to_numpy()
    alcohol = base_df["alcohol_frequency"].map(
        {"Never": 0.0, "Occasionally": 0.1, "Regularly": 0.7, "Heavy": 1.9}
    ).to_numpy()
    static = (
        1.2
        + 0.7 * bmi_z
        + 0.5 * age_z
        + smoke
        + alcohol
        - 0.25 * base_df["physical_activity_days_per_week"].to_numpy()
        + 0.025 * base_df["distance_from_work_km"].to_numpy()
        + 0.1 * base_df["number_of_dependents"].to_numpy()
    )

    targeted = cohort_cols[INTERVENTION_DIMENSION] == INTERVENTION_COHORT

    # --- Walk the periods ---------------------------------------------------
    records = []
    for i, period in enumerate(PERIODS):
        rng = np.random.default_rng(SEED * 1000 + i)
        month = int(period[5:7])
        post = period >= INTERVENTION_PERIOD

        # Month to month drift in the operational inputs. Small and mean
        # reverting: a workforce's overtime wanders, it does not reset.
        overtime = np.clip(
            base_df["overtime_hours_14d"].to_numpy() * rng.normal(1.0, 0.12, len(base_df)), 0, 90
        )
        shifts = np.clip(
            base_df["consecutive_shifts_worked"].to_numpy()
            + rng.integers(-2, 3, len(base_df)),
            0,
            21,
        )
        sleep = np.clip(
            base_df["sleep_hours_avg_7d"].to_numpy() + rng.normal(0, 0.25, len(base_df)), 3.5, 10.0
        )
        workload = np.clip(
            base_df["workload_index_current"].to_numpy() * rng.normal(1.0, 0.06, len(base_df)),
            80,
            380,
        )
        leave_gap = np.clip(
            base_df["days_since_last_leave"].to_numpy() + rng.normal(0, 20, len(base_df)), 0, 365
        )

        # The simulated roster change: a consecutive-shift cap and less
        # overtime, for the targeted cohort only, from the intervention period
        # onward. This is the mechanism, not the outcome.
        if post:
            overtime = np.where(targeted, overtime * 0.72, overtime)
            shifts = np.where(targeted, np.minimum(shifts, 8), shifts)

        fatigue = _fatigue(
            sleep, overtime, shifts, leave_gap, workload, rng.normal(0, 6.0, len(base_df))
        )
        hours = _absence_hours(static, fatigue, workload, rng)
        # Winter sits on top of the model's world, because infection is not in
        # the feature set.
        hours = hours * WINTER.get(month, 1.0)

        days = hours / HOURS_PER_DAY
        row = {
            "period_start": period,
            "data_as_of": period,
            "days": days,
            "fatigue": fatigue,
        }
        records.append(row)

    # --- Aggregate per frozen cohort per period -----------------------------
    series = {}
    for dim in feed_enrich.DIMENSIONS:
        key = dim["key"]
        floor = dim.get("min_cohort", feed_enrich.SUPPRESSION_THRESHOLD)
        labels = [lab for lab in dim["order"] if (cohort_cols[key] == lab).any()]

        per_cohort = {}
        for label in labels:
            mask = cohort_cols[key] == label
            n = int(mask.sum())
            points = []
            for rec in records:
                d = rec["days"][mask]
                points.append(
                    {
                        "period_start": rec["period_start"],
                        "data_as_of": rec["data_as_of"],
                        "count": n,
                        # Scaled to an annual rate so it is the same unit the
                        # cohort screens already report.
                        "absent_days_per_head_annual": round(
                            float(d.sum()) / max(1, n) * 12, 1
                        ),
                        "absent_days_total": round(float(d.sum()), 1),
                        "mean_fatigue": round(float(rec["fatigue"][mask].mean()), 1),
                    }
                )
            per_cohort[label] = {
                "label": label,
                "count": n,
                # One cohort, one membership, for every period. Stated in the
                # payload so a reader does not have to infer it.
                "membership": "frozen at baseline",
                "suppressed": n < floor,
                "suppressed_below": floor if n < floor else None,
                "periods": [] if n < floor else points,
            }

        series[key] = {
            "label": dim["label"],
            "protected": bool(dim.get("protected")),
            "min_cohort": floor,
            "cohorts": per_cohort,
        }

    out = {
        "schema_version": 2,
        "periods": PERIODS,
        "period_grain": "month",
        "measure": "absent_days_per_head_annual",
        "measure_source": "actual absence, not model prediction",
        "membership": "frozen at the baseline period",
        "suppression_threshold": feed_enrich.SUPPRESSION_THRESHOLD,
        "synthetic": True,
        "simulation": {
            "intervention_period": INTERVENTION_PERIOD,
            "intervention_dimension": INTERVENTION_DIMENSION,
            "intervention_cohort": INTERVENTION_COHORT,
            "mechanism": (
                "From the intervention period the targeted cohort's overtime falls by 28 percent "
                "and consecutive shifts are capped at 8. The absence that follows is whatever the "
                "data-generating process produces from those inputs. No outcome is written in by hand."
            ),
            "seasonality": (
                "A winter multiplier is applied to every cohort for May to September, peaking at "
                "1.30 in July. Infection-driven, so it moves absence without moving any model "
                "feature, which is why a before and after on the targeted cohort alone is misleading."
            ),
            "caveat": (
                "On a client's data the mechanism is unknown. The platform reports an observed "
                "difference against comparable cohorts and does not claim a cause."
            ),
        },
        "series": series,
    }

    path = f"{ROOT}/data/outputs/cohort_series.json"
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2, default=float)

    print(f"wrote {path}")
    print(f"  periods: {len(PERIODS)} ({PERIODS[0]} to {PERIODS[-1]}), grain month")
    print("  measure: actual absent days per head, annualised")
    tgt = series[INTERVENTION_DIMENSION]["cohorts"][INTERVENTION_COHORT]
    print(f"\n  {INTERVENTION_COHORT} (n={tgt['count']}, membership frozen):")
    for p in tgt["periods"]:
        mark = " <- roster change" if p["period_start"] == INTERVENTION_PERIOD else ""
        print(f"    {p['period_start']}  {p['absent_days_per_head_annual']:6.1f} days/head/yr{mark}")
    for other in series[INTERVENTION_DIMENSION]["cohorts"]:
        if other == INTERVENTION_COHORT:
            continue
        pts = series[INTERVENTION_DIMENSION]["cohorts"][other]["periods"]
        if not pts:
            continue
        pre = [p["absent_days_per_head_annual"] for p in pts if p["period_start"] < INTERVENTION_PERIOD]
        post = [p["absent_days_per_head_annual"] for p in pts if p["period_start"] >= INTERVENTION_PERIOD]
        print(f"  {other:>20}: pre {np.mean(pre):6.1f}  post {np.mean(post):6.1f}  "
              f"change {np.mean(post) - np.mean(pre):+.1f}")
    pre = [p["absent_days_per_head_annual"] for p in tgt["periods"] if p["period_start"] < INTERVENTION_PERIOD]
    post = [p["absent_days_per_head_annual"] for p in tgt["periods"] if p["period_start"] >= INTERVENTION_PERIOD]
    print(f"  {INTERVENTION_COHORT:>20}: pre {np.mean(pre):6.1f}  post {np.mean(post):6.1f}  "
          f"change {np.mean(post) - np.mean(pre):+.1f}")
    return out


if __name__ == "__main__":
    build()
