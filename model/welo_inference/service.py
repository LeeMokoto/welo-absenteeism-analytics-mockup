"""Service-layer wrapper around the existing pipeline.

Loads the saved model artifacts and cached dashboard feed once at app
startup, then answers /score and /feed requests in-memory.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

import joblib
import numpy as np
import pandas as pd
import shap

from welo_pipeline.features import build_features
from welo_pipeline.explain import _humanise

from .config import InferenceConfig

log = logging.getLogger("welo.inference")


class InferenceService:
    """Stateful scorer. Build it once per process and share it across requests."""

    def __init__(self, config: InferenceConfig) -> None:
        self.config = config
        self._loaded = False
        self.regressor = None
        self.classifier = None
        self.manifest: Dict[str, Any] = {}
        self.class_labels: List[str] = []
        self.feature_names: List[str] = []
        self._shap_explainer = None
        self._shap_feature_names: List[str] = []
        self.dashboard_feed: Dict[str, Any] = {}

    def load(self) -> None:
        models_dir = Path(self.config.models_dir)
        log.info("loading model artifacts from %s", models_dir)
        self.regressor = joblib.load(models_dir / "regressor.joblib")
        self.classifier = joblib.load(models_dir / "classifier.joblib")
        self.manifest = joblib.load(models_dir / "manifest.joblib")
        self.class_labels = list(self.manifest.get("class_labels", []))
        self.feature_names = list(self.manifest.get("feature_names", []))

        feed_path = Path(self.config.dashboard_feed_path)
        if feed_path.exists():
            log.info("loading dashboard feed from %s", feed_path)
            self.dashboard_feed = json.loads(feed_path.read_text())
        else:
            log.warning("dashboard feed not found at %s; /feed will 404", feed_path)
            self.dashboard_feed = {}

        try:
            tree_model = self.regressor.named_steps["model"]
            self._shap_explainer = shap.TreeExplainer(tree_model)
            self._shap_feature_names = list(
                self.regressor.named_steps["pre"].get_feature_names_out()
            )
            log.info("SHAP explainer ready (%d features)", len(self._shap_feature_names))
        except Exception as exc:  # pragma: no cover - safety net
            log.warning("could not initialise SHAP explainer: %s", exc)
            self._shap_explainer = None

        self._loaded = True

    @property
    def ready(self) -> bool:
        return self._loaded and self.regressor is not None and self.classifier is not None

    @property
    def model_version(self) -> str:
        return str(self.dashboard_feed.get("run_name", "unknown"))

    def metrics(self) -> Dict[str, Any]:
        return self.dashboard_feed.get("model_metrics", {})

    def provenance(self) -> List[Dict[str, Any]]:
        return self.dashboard_feed.get("data_provenance", [])

    def score(
        self,
        employees: List[Dict[str, Any]],
        include_reasons: bool = False,
    ) -> List[Dict[str, Any]]:
        if not self.ready:
            raise RuntimeError("Service not ready: model not loaded.")

        df = pd.DataFrame(employees)
        if "source_dataset" not in df.columns:
            df["source_dataset"] = "live_request"
        if "absence_duration_hours" not in df.columns:
            df["absence_duration_hours"] = np.nan
        if "employee_id" not in df.columns:
            df["employee_id"] = np.arange(len(df))

        bundle = build_features(df, thresholds=self.config.risk_band_thresholds)

        hours = np.clip(self.regressor.predict(bundle.X), 0, None)
        days_h = hours / self.config.hours_per_day
        days_90d = days_h * (self.config.horizon_days / 30.0)

        band_pred = self.classifier.predict(bundle.X)
        proba = self.classifier.predict_proba(bundle.X)

        reasons_by_row: Dict[int, List[Dict[str, Any]]] = {}
        if include_reasons and self._shap_explainer is not None:
            X_trans = self.regressor.named_steps["pre"].transform(bundle.X)
            shap_values = self._shap_explainer.shap_values(X_trans)
            cat_features = list(bundle.categorical_features)
            for i in range(len(bundle.X)):
                row = shap_values[i]
                order = np.argsort(-row)
                positive = [(self._shap_feature_names[j], float(row[j])) for j in order if row[j] > 0][:3]
                reasons_by_row[i] = [
                    {
                        "feature": name,
                        "label": _humanise(name, cat_features),
                        "shap_hours": round(val, 2),
                    }
                    for name, val in positive
                ]

        out: List[Dict[str, Any]] = []
        for i in range(len(bundle.X)):
            prob_dict = {
                str(self.class_labels[k]).lower(): float(round(proba[i, k], 4))
                for k in range(len(self.class_labels))
            }
            employee_id = bundle.employee_id.iloc[i]
            fatigue_score = bundle.X["fatigue_burnout_score"].iloc[i] if "fatigue_burnout_score" in bundle.X.columns else None
            fatigue_band = bundle.X["fatigue_band"].iloc[i] if "fatigue_band" in bundle.X.columns else None
            entry: Dict[str, Any] = {
                "employee_id": int(employee_id) if pd.notna(employee_id) else None,
                "predicted_absent_hours": round(float(hours[i]), 2),
                "predicted_absent_days_monthly": round(float(days_h[i]), 2),
                "predicted_absent_days_90d": round(float(days_90d[i]), 2),
                "predicted_risk_band": str(band_pred[i]),
                "probabilities": prob_dict,
                "fatigue_burnout_score": (
                    round(float(fatigue_score), 1) if pd.notna(fatigue_score) else None
                ),
                "fatigue_band": str(fatigue_band) if pd.notna(fatigue_band) else None,
            }
            if include_reasons:
                entry["top_reasons"] = reasons_by_row.get(i, [])
            out.append(entry)

        return out
