"""End-to-end pipeline orchestrator.

A single call chains every stage in order and returns a structured
result. Both the demo notebook and the command-line entry point go
through this function, so the orchestration logic only ever lives in
one place.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict

import pandas as pd

from .config import PipelineConfig
from .ingest import ingest
from .validate import validate
from .features import build_features
from .train import train
from .score import score
from .explain import explain
from .export import build_dashboard_feed, write_outputs


@dataclass
class PipelineResult:
    config: PipelineConfig
    raw: pd.DataFrame
    validation_report: Dict[str, Any]
    features: Any
    artifacts: Any
    predictions: pd.DataFrame
    explanations: Dict[str, Any]
    dashboard_feed: Dict[str, Any]
    output_paths: Dict[str, str]
    elapsed_seconds: Dict[str, float] = field(default_factory=dict)


def run_pipeline(config: PipelineConfig) -> PipelineResult:
    config.ensure_dirs()
    timings: Dict[str, float] = {}

    t = time.perf_counter()
    raw = ingest(config)
    timings["ingest"] = round(time.perf_counter() - t, 3)

    t = time.perf_counter()
    report = validate(raw, target_col=config.target.regression).to_dict()
    timings["validate"] = round(time.perf_counter() - t, 3)
    Path(config.output.reports_dir).mkdir(parents=True, exist_ok=True)
    (Path(config.output.reports_dir) / "validation_report.json").write_text(
        json.dumps(report, indent=2, default=float)
    )

    t = time.perf_counter()
    bundle = build_features(raw, thresholds=config.target.risk_band_thresholds)
    timings["features"] = round(time.perf_counter() - t, 3)

    t = time.perf_counter()
    artifacts = train(
        bundle,
        seed=config.random_seed,
        reg_cv_folds=config.model.regression.cv_folds,
        cls_cv_folds=config.model.classification.cv_folds,
        models_dir=config.output.models_dir,
    )
    timings["train"] = round(time.perf_counter() - t, 3)
    (Path(config.output.reports_dir) / "model_metrics.json").write_text(
        json.dumps(artifacts.metrics, indent=2, default=float)
    )

    t = time.perf_counter()
    predictions = score(bundle, models_dir=config.output.models_dir)
    timings["score"] = round(time.perf_counter() - t, 3)

    t = time.perf_counter()
    explanations = explain(bundle, artifacts.regressor, random_state=config.random_seed)
    timings["explain"] = round(time.perf_counter() - t, 3)

    t = time.perf_counter()
    feed = build_dashboard_feed(
        predictions=predictions,
        metrics=artifacts.metrics,
        explanations=explanations,
        run_name=config.run_name,
    )
    output_paths = write_outputs(
        predictions=predictions,
        feed=feed,
        predictions_dir=config.output.predictions_dir,
        dashboard_json=config.output.dashboard_json,
    )
    timings["export"] = round(time.perf_counter() - t, 3)

    return PipelineResult(
        config=config,
        raw=raw,
        validation_report=report,
        features=bundle,
        artifacts=artifacts,
        predictions=predictions,
        explanations=explanations,
        dashboard_feed=feed,
        output_paths=output_paths,
        elapsed_seconds=timings,
    )
