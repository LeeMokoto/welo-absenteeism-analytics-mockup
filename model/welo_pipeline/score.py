"""Score stage.

Loads the persisted models and produces per-employee predictions:
predicted absent hours, derived predicted days, risk band and per-band
probabilities. The output is the table that drives every per-employee
panel in the dashboard.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import joblib
import numpy as np
import pandas as pd

from .features import FeatureBundle


def _load_artifacts(models_dir: str | Path) -> Dict[str, Any]:
    models_dir = Path(models_dir)
    return {
        "regressor": joblib.load(models_dir / "regressor.joblib"),
        "classifier": joblib.load(models_dir / "classifier.joblib"),
        "manifest": joblib.load(models_dir / "manifest.joblib"),
    }


def score(
    bundle: FeatureBundle,
    models_dir: str | Path = "models",
    hours_per_day: float = 8.0,
    horizon_days: int = 90,
) -> pd.DataFrame:
    artifacts = _load_artifacts(models_dir)
    reg = artifacts["regressor"]
    cls = artifacts["classifier"]
    class_labels = list(artifacts["manifest"]["class_labels"])

    hours = np.clip(reg.predict(bundle.X), 0, None)
    days_h = hours / hours_per_day
    days_90d = days_h * (horizon_days / 30.0)

    band_pred = cls.predict(bundle.X)
    proba = cls.predict_proba(bundle.X)

    out = pd.DataFrame(
        {
            "row_id": np.arange(len(bundle.X), dtype=int),
            "employee_id": bundle.employee_id.values,
            "source_dataset": bundle.source_dataset.values,
            "predicted_absent_hours": np.round(hours, 2),
            "predicted_absent_days_monthly": np.round(days_h, 2),
            "predicted_absent_days_90d": np.round(days_90d, 2),
            "predicted_risk_band": band_pred,
            "fatigue_burnout_score": bundle.X["fatigue_burnout_score"].values
            if "fatigue_burnout_score" in bundle.X.columns
            else np.nan,
            "fatigue_band": bundle.X["fatigue_band"].values
            if "fatigue_band" in bundle.X.columns
            else None,
        }
    )
    for i, label in enumerate(class_labels):
        out[f"prob_{label.lower()}"] = np.round(proba[:, i], 4)

    out["actual_absent_hours"] = bundle.y_reg.values
    out["actual_risk_band"] = bundle.y_band.values
    return out
