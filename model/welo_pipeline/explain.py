"""Explain stage.

Uses SHAP to produce two complementary artifacts. The first is a global
feature-importance ranking computed as the mean absolute SHAP value per
feature. The second is a per-employee list of top reasons: for each
person we surface the three features pushing their predicted hours up
the most, and those reasons feed the intervention queue and the
employee deep-dive cards on the dashboard.
"""

from __future__ import annotations

from typing import List

import numpy as np
import pandas as pd
import shap

from .features import FeatureBundle


def _transformed_feature_names(regressor) -> List[str]:
    pre = regressor.named_steps["pre"]
    return list(pre.get_feature_names_out())


_HUMAN_NAME = {
    "num__workload_index_current": "Workload index elevated",
    "num__smoker_alcohol_load": "Smoking + alcohol load",
    "num__metabolic_load": "Metabolic load (BMI / age)",
    "num__age": "Age",
    "num__physical_activity_days_per_week": "Low physical activity",
    "num__inactivity_score": "Inactivity score",
    "num__bmi": "BMI",
    "num__distance_from_work_km": "Commute distance",
    "num__workload_x_tenure": "Workload vs tenure",
    "num__tenure_years": "Tenure",
    "num__number_of_dependents": "Dependents",
    "num__number_of_children": "Children",
    "num__fatigue_burnout_score": "Fatigue / burnout elevated",
    "num__sleep_hours_avg_7d": "Sleep deficit (7-day avg)",
    "num__overtime_hours_14d": "Overtime hours (14d)",
    "num__consecutive_shifts_worked": "Consecutive shifts worked",
    "num__days_since_last_leave": "Days since last leave",
    "num__perceived_stress_score": "Perceived stress (PSS-10)",
}


def _humanise(feature: str, categorical_features: List[str] | None = None) -> str:
    if feature in _HUMAN_NAME:
        return _HUMAN_NAME[feature]
    if feature.startswith("cat__"):
        rest = feature[len("cat__"):]
        if categorical_features:
            matches = [c for c in categorical_features if rest == c or rest.startswith(c + "_")]
            if matches:
                col = max(matches, key=len)
                value = rest[len(col) + 1:] if len(rest) > len(col) else ""
                label = col.replace("_", " ").strip().capitalize()
                return f"{label}: {value}" if value else label
        base, _, value = rest.rpartition("_")
        label = (base or rest).replace("_", " ").strip().capitalize()
        return f"{label}: {value}" if value else label
    return feature.replace("num__", "").replace("_", " ")


def explain(
    bundle: FeatureBundle,
    regressor,
    max_rows: int = 2000,
    top_k_reasons: int = 3,
    random_state: int = 7,
) -> dict:
    rng = np.random.default_rng(random_state)
    n = len(bundle.X)
    if n <= max_rows:
        idx = np.arange(n)
    else:
        idx = np.sort(rng.choice(n, size=max_rows, replace=False))

    X_sample = bundle.X.iloc[idx].reset_index(drop=True)
    pre = regressor.named_steps["pre"]
    model = regressor.named_steps["model"]
    X_trans = pre.transform(X_sample)

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_trans)

    feature_names = _transformed_feature_names(regressor)
    cat_features = list(bundle.categorical_features)
    abs_mean = np.abs(shap_values).mean(axis=0)
    global_importance = (
        pd.DataFrame(
            {
                "feature": feature_names,
                "feature_label": [_humanise(f, cat_features) for f in feature_names],
                "mean_abs_shap": abs_mean,
            }
        )
        .sort_values("mean_abs_shap", ascending=False)
        .reset_index(drop=True)
    )

    per_row_reasons = []
    for i in range(len(idx)):
        row = shap_values[i]
        order = np.argsort(-row)
        positive_drivers = [(feature_names[j], float(row[j])) for j in order if row[j] > 0][:top_k_reasons]
        per_row_reasons.append(
            [
                {
                    "feature": name,
                    "label": _humanise(name, cat_features),
                    "shap_hours": round(val, 2),
                }
                for name, val in positive_drivers
            ]
        )

    reasons_by_row_pos = {int(pos): per_row_reasons[i] for i, pos in enumerate(idx)}

    return {
        "global_importance": global_importance,
        "per_row_reasons": reasons_by_row_pos,
        "explained_rows": int(len(idx)),
        "total_rows": int(n),
    }
