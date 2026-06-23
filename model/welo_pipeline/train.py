"""Train stage.

This stage fits two models off the same feature matrix. The first is a
regression model that predicts ``absence_duration_hours``, which powers
the "predicted absent days" headline on the dashboard. The second is a
classification model that predicts the derived risk band (Low, Medium,
High, Critical) and drives the risk-distribution and intervention-queue
panels.

Both models live inside a sklearn pipeline that bundles the preprocessor
with a HistGradientBoosting estimator, so the persisted artifact is
fully self-contained and scoring new data is one call to ``predict`` with
no manual preprocessing.

Metrics are reported as cross-validated values alongside the in-sample
fit so the honest performance number always travels with the artifact.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    balanced_accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    roc_auc_score,
)
from sklearn.model_selection import KFold, StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .features import FeatureBundle


@dataclass
class TrainedArtifacts:
    regressor: Any
    classifier: Any
    class_labels: List[str]
    metrics: Dict[str, Any] = field(default_factory=dict)
    cv_predictions: Dict[str, np.ndarray] = field(default_factory=dict)


def _make_preprocessor(numeric: List[str], categorical: List[str]) -> ColumnTransformer:
    num_pipe = Pipeline(
        steps=[("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]
    )
    cat_pipe = Pipeline(
        steps=[
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]
    )
    return ColumnTransformer(
        transformers=[("num", num_pipe, numeric), ("cat", cat_pipe, categorical)],
        remainder="drop",
    )


def train(
    bundle: FeatureBundle,
    *,
    seed: int = 7,
    reg_cv_folds: int = 5,
    cls_cv_folds: int = 5,
    models_dir: str | Path = "models",
) -> TrainedArtifacts:
    models_dir = Path(models_dir)
    models_dir.mkdir(parents=True, exist_ok=True)

    preprocessor_reg = _make_preprocessor(bundle.numeric_features, bundle.categorical_features)
    regressor = Pipeline(
        steps=[
            ("pre", preprocessor_reg),
            (
                "model",
                HistGradientBoostingRegressor(
                    learning_rate=0.06,
                    max_depth=5,
                    max_iter=500,
                    min_samples_leaf=20,
                    l2_regularization=0.5,
                    random_state=seed,
                    early_stopping=True,
                    validation_fraction=0.15,
                ),
            ),
        ]
    )

    preprocessor_cls = _make_preprocessor(bundle.numeric_features, bundle.categorical_features)
    classifier = Pipeline(
        steps=[
            ("pre", preprocessor_cls),
            (
                "model",
                HistGradientBoostingClassifier(
                    learning_rate=0.06,
                    max_depth=5,
                    max_iter=400,
                    min_samples_leaf=15,
                    l2_regularization=0.5,
                    random_state=seed,
                ),
            ),
        ]
    )

    cv_reg = KFold(n_splits=reg_cv_folds, shuffle=True, random_state=seed)
    y_reg_pred = cross_val_predict(regressor, bundle.X, bundle.y_reg, cv=cv_reg, n_jobs=-1)

    y_band = pd.Series(bundle.y_band).fillna("Low").astype(str)
    class_labels = ["Low", "Medium", "High", "Critical"]
    cv_cls = StratifiedKFold(n_splits=cls_cv_folds, shuffle=True, random_state=seed)
    y_band_pred = cross_val_predict(classifier, bundle.X, y_band, cv=cv_cls, n_jobs=-1)
    y_band_proba = cross_val_predict(
        classifier, bundle.X, y_band, cv=cv_cls, method="predict_proba", n_jobs=-1
    )

    regressor.fit(bundle.X, bundle.y_reg)
    classifier.fit(bundle.X, y_band)

    metrics: Dict[str, Any] = {
        "regression": {
            "n_train": int(len(bundle.y_reg)),
            "cv_mae": round(float(mean_absolute_error(bundle.y_reg, y_reg_pred)), 3),
            "cv_rmse": round(float(np.sqrt(mean_squared_error(bundle.y_reg, y_reg_pred))), 3),
            "cv_r2": round(float(r2_score(bundle.y_reg, y_reg_pred)), 3),
            "target_mean": round(float(bundle.y_reg.mean()), 3),
            "target_std": round(float(bundle.y_reg.std()), 3),
        },
        "classification": {
            "n_train": int(len(y_band)),
            "class_distribution": {
                str(k): int(v) for k, v in y_band.value_counts().sort_index().to_dict().items()
            },
            "cv_balanced_accuracy": round(float(balanced_accuracy_score(y_band, y_band_pred)), 3),
            "cv_f1_macro": round(
                float(f1_score(y_band, y_band_pred, average="macro", zero_division=0)), 3
            ),
        },
    }

    try:
        class_order = list(classifier.classes_)
        y_band_idx = np.array([class_order.index(c) for c in y_band])
        y_band_onehot = np.eye(len(class_order))[y_band_idx]
        metrics["classification"]["cv_roc_auc_macro_ovr"] = round(
            float(
                roc_auc_score(
                    y_band_onehot, y_band_proba, average="macro", multi_class="ovr"
                )
            ),
            3,
        )
        class_labels = class_order
    except Exception as exc:  # pragma: no cover - safety net
        metrics["classification"]["cv_roc_auc_macro_ovr"] = None
        metrics["classification"]["roc_auc_error"] = str(exc)

    joblib.dump(regressor, models_dir / "regressor.joblib")
    joblib.dump(classifier, models_dir / "classifier.joblib")
    joblib.dump(
        {"class_labels": class_labels, "feature_names": bundle.feature_names},
        models_dir / "manifest.joblib",
    )

    return TrainedArtifacts(
        regressor=regressor,
        classifier=classifier,
        class_labels=class_labels,
        metrics=metrics,
        cv_predictions={"y_reg_pred": y_reg_pred, "y_band_pred": y_band_pred},
    )
