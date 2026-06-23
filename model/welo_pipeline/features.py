"""Feature engineering.

A pure transformation stage. It takes the canonical DataFrame and
returns the feature matrix ``X`` together with the regression target
``y_reg`` and the derived classification target ``y_band``. No model
fitting happens here.

The guiding principle is that every engineered feature has to make
clinical or operational sense to a domain expert, because the dashboard
ultimately surfaces these features as explanations to non-technical
users.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

import numpy as np
import pandas as pd


CATEGORICAL_FEATURES = [
    "gender",
    "marital_status",
    "education_level",
    "smoking_status",
    "alcohol_frequency",
    "bmi_band",
    "age_band",
    "distance_band",
    "workload_band",
    "fatigue_band",
]

NUMERIC_FEATURES = [
    "age",
    "tenure_years",
    "distance_from_work_km",
    "bmi",
    "height_cm",
    "weight_kg",
    "physical_activity_days_per_week",
    "workload_index_current",
    "number_of_dependents",
    "number_of_children",
    "sleep_hours_avg_7d",
    "overtime_hours_14d",
    "consecutive_shifts_worked",
    "days_since_last_leave",
    "perceived_stress_score",
    "smoker_alcohol_load",
    "inactivity_score",
    "workload_x_tenure",
    "metabolic_load",
    "fatigue_burnout_score",
]


@dataclass
class FeatureBundle:
    X: pd.DataFrame
    y_reg: pd.Series
    y_band: pd.Series
    feature_names: List[str]
    categorical_features: List[str]
    numeric_features: List[str]
    employee_id: pd.Series
    source_dataset: pd.Series


def _band(series: pd.Series, edges: List[float], labels: List[str]) -> pd.Series:
    return pd.cut(series, bins=edges, labels=labels, include_lowest=True).astype("object")


def _derive_fatigue_score(out: pd.DataFrame) -> pd.Series:
    """Composite fatigue and burnout score on a 0 to 100 scale.

    The score is built from the same inputs that Welo's occupational
    health screen would capture. When none of those inputs are present
    for a row, the function returns ``NaN`` so the pipeline's imputer
    can fill the value with the cohort median. That keeps SHAP neutral
    on those rows rather than fabricating a fatigue story from thin
    air.
    """

    def _col(name: str) -> pd.Series:
        if name in out.columns:
            return pd.to_numeric(out[name], errors="coerce")
        return pd.Series(pd.NA, index=out.index, dtype="Float64")

    sleep = _col("sleep_hours_avg_7d")
    overtime = _col("overtime_hours_14d")
    shifts = _col("consecutive_shifts_worked")
    leave_gap = _col("days_since_last_leave")
    workload = _col("workload_index_current")
    pss = _col("perceived_stress_score")

    inputs = pd.concat([sleep, overtime, shifts, leave_gap, workload, pss], axis=1)
    has_any_input = inputs.notna().any(axis=1)

    sleep_deficit = (6.5 - sleep.fillna(6.5)).clip(lower=0) * 6.5
    overtime_contrib = (overtime.fillna(0) / 40.0 * 25.0).clip(upper=25.0)
    shift_contrib = (shifts.fillna(0) / 14.0 * 15.0).clip(upper=15.0)
    leave_contrib = (leave_gap.fillna(0) / 180.0 * 15.0).clip(upper=15.0)
    workload_contrib = ((workload.fillna(220) - 240) / 5.0).clip(lower=0, upper=20)
    pss_contrib = (pss.fillna(15) - 13).clip(lower=0) * 0.9

    score = 18.0 + sleep_deficit + overtime_contrib + shift_contrib + leave_contrib + workload_contrib + pss_contrib
    score = score.clip(lower=0, upper=100).round(1)
    return score.where(has_any_input, other=pd.NA)


def build_features(df: pd.DataFrame, thresholds: dict) -> FeatureBundle:
    out = df.copy()

    numeric_base_cols = [
        c for c in NUMERIC_FEATURES + ["absence_duration_hours"]
        if c not in {"smoker_alcohol_load", "inactivity_score", "workload_x_tenure",
                     "metabolic_load", "fatigue_burnout_score"}
    ]
    for col in numeric_base_cols:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")

    out["bmi_band"] = _band(
        out["bmi"],
        edges=[0, 18.5, 25, 30, 35, 100],
        labels=["under", "normal", "overweight", "obese_I", "obese_II_plus"],
    )
    out["age_band"] = _band(
        out["age"],
        edges=[0, 25, 35, 45, 55, 100],
        labels=["<25", "25-34", "35-44", "45-54", "55+"],
    )
    out["distance_band"] = _band(
        out["distance_from_work_km"],
        edges=[-0.01, 5, 15, 30, 1000],
        labels=["near", "moderate", "far", "very_far"],
    )
    out["workload_band"] = _band(
        out["workload_index_current"],
        edges=[0, 180, 240, 300, 1000],
        labels=["light", "normal", "elevated", "extreme"],
    )

    smoke_w = {"Never": 0, "Former": 1, "Occasional": 2, "Daily": 3}
    alc_w = {"Never": 0, "Occasionally": 1, "Regularly": 2, "Heavy": 3}
    out["smoker_alcohol_load"] = (
        out["smoking_status"].map(smoke_w).fillna(0).astype(float)
        + out["alcohol_frequency"].map(alc_w).fillna(0).astype(float)
    )

    out["inactivity_score"] = (7 - out["physical_activity_days_per_week"].fillna(3.5)).clip(0, 7)
    out["workload_x_tenure"] = (
        out["workload_index_current"].fillna(out["workload_index_current"].median())
        * (1.0 / (1.0 + out["tenure_years"].fillna(out["tenure_years"].median())))
    )
    out["metabolic_load"] = (
        (out["bmi"].fillna(out["bmi"].median()) - 25).clip(lower=0)
        + 0.25 * (out["age"].fillna(out["age"].median()) - 40).clip(lower=0)
    )

    out["fatigue_burnout_score"] = _derive_fatigue_score(out)
    out["fatigue_band"] = _band(
        out["fatigue_burnout_score"],
        edges=[-0.01, 30, 50, 70, 101],
        labels=["low", "moderate", "high", "critical"],
    )

    y_reg = out["absence_duration_hours"].astype(float)

    low_t = thresholds["low"]
    med_t = thresholds["medium"]
    high_t = thresholds["high"]
    y_band = pd.cut(
        y_reg,
        bins=[-0.01, low_t, med_t, high_t, 10_000],
        labels=["Low", "Medium", "High", "Critical"],
    ).astype("object")

    feature_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    X = out[feature_cols].copy()

    return FeatureBundle(
        X=X,
        y_reg=y_reg,
        y_band=y_band,
        feature_names=feature_cols,
        categorical_features=CATEGORICAL_FEATURES,
        numeric_features=NUMERIC_FEATURES,
        employee_id=out["employee_id"].reset_index(drop=True),
        source_dataset=out["source_dataset"].reset_index(drop=True),
    )
