"""Export stage.

Turns model outputs into the JSON shape the dashboard panels consume.
The dashboard loads a single ``dashboard_feed.json`` file and fills
every panel from it, so no bespoke aggregation has to live in the
front-end.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd


HOURS_PER_DAY = 8.0
ANNUAL_RAND_PER_DAY = 1100.0


def build_dashboard_feed(
    predictions: pd.DataFrame,
    metrics: Dict[str, Any],
    explanations: Dict[str, Any],
    run_name: str,
) -> Dict[str, Any]:
    p = predictions.copy()

    band_counts = (
        p["predicted_risk_band"]
        .value_counts()
        .reindex(["Critical", "High", "Medium", "Low"])
        .fillna(0)
        .astype(int)
    )
    band_share = (band_counts / max(1, band_counts.sum())).round(4)

    headline_days_90d = float(p["predicted_absent_days_90d"].sum().round(0))
    headline_days_annual = float((p["predicted_absent_days_monthly"] * 12).sum().round(0))
    cost_exposure_rand = round(headline_days_annual * ANNUAL_RAND_PER_DAY, 0)
    addressable_saving_rand = round(cost_exposure_rand * 0.042, 0)

    queue_cols = [
        "row_id",
        "employee_id",
        "source_dataset",
        "predicted_absent_hours",
        "predicted_absent_days_90d",
        "predicted_risk_band",
    ]
    if "fatigue_burnout_score" in p.columns:
        queue_cols.append("fatigue_burnout_score")
    if "fatigue_band" in p.columns:
        queue_cols.append("fatigue_band")
    intervention_df = (
        p.sort_values("predicted_absent_hours", ascending=False)
        .head(20)
        .loc[:, queue_cols]
    )
    reasons_by_row = explanations.get("per_row_reasons", {})
    intervention = []
    for _, row in intervention_df.iterrows():
        rec = row.to_dict()
        rec["row_id"] = int(rec["row_id"])
        rec["employee_id"] = (
            int(rec["employee_id"]) if pd.notna(rec["employee_id"]) else None
        )
        rec["top_reasons"] = reasons_by_row.get(rec["row_id"], [])
        intervention.append(rec)

    global_imp: List[Dict[str, Any]] = (
        explanations["global_importance"].head(10).to_dict(orient="records")
    )

    fatigue_segment = []
    fatigue_summary: Dict[str, Any] = {}
    if "fatigue_band" in p.columns and p["fatigue_band"].notna().any():
        fb_counts = (
            p["fatigue_band"]
            .reindex(p.index)
            .fillna("unknown")
            .value_counts()
            .reindex(["critical", "high", "moderate", "low"])
            .fillna(0)
            .astype(int)
        )
        fb_share = (fb_counts / max(1, fb_counts.sum())).round(4)
        fatigue_segment = [
            {"band": b.capitalize(), "count": int(fb_counts[b]), "share": float(fb_share[b])}
            for b in ["critical", "high", "moderate", "low"]
        ]

    if "fatigue_burnout_score" in p.columns and p["fatigue_burnout_score"].notna().any():
        scored = pd.to_numeric(p["fatigue_burnout_score"], errors="coerce").dropna()
        fatigue_summary = {
            "mean": round(float(scored.mean()), 1),
            "median": round(float(scored.median()), 1),
            "p90": round(float(scored.quantile(0.90)), 1),
            "share_high_or_critical": round(float((scored >= 50).mean()), 4),
        }

    return {
        "run_name": run_name,
        "headline": {
            "covered_lives": int(len(p)),
            "predicted_absent_days_90d": headline_days_90d,
            "predicted_absent_days_annual": headline_days_annual,
            "absence_cost_exposure_rand": cost_exposure_rand,
            "projected_addressable_saving_rand": addressable_saving_rand,
            "fatigue_high_or_critical_share": fatigue_summary.get("share_high_or_critical"),
        },
        "risk_distribution": [
            {
                "band": band,
                "count": int(band_counts[band]),
                "share": float(band_share[band]),
            }
            for band in ["Critical", "High", "Medium", "Low"]
        ],
        "fatigue_burnout": {
            "segment": fatigue_segment,
            "summary": fatigue_summary,
        },
        "intervention_queue": intervention,
        "global_feature_importance": global_imp,
        "model_metrics": metrics,
        "data_provenance": (
            p["source_dataset"]
            .fillna("unknown")
            .value_counts()
            .rename_axis("source")
            .reset_index(name="rows")
            .to_dict(orient="records")
        ),
    }


def write_outputs(
    predictions: pd.DataFrame,
    feed: Dict[str, Any],
    predictions_dir: str | Path,
    dashboard_json: str | Path,
) -> Dict[str, str]:
    predictions_dir = Path(predictions_dir)
    predictions_dir.mkdir(parents=True, exist_ok=True)
    dashboard_json = Path(dashboard_json)
    dashboard_json.parent.mkdir(parents=True, exist_ok=True)

    pred_csv = predictions_dir / "predictions.csv"
    predictions.to_csv(pred_csv, index=False)

    dashboard_json.write_text(json.dumps(feed, indent=2, default=float))

    dashboard_js = dashboard_json.with_suffix(".js")
    js_payload = (
        "// Auto-generated by welo_pipeline.export. Do not edit by hand.\n"
        "// Source: " + dashboard_json.name + "\n"
        "window.WELO_FEED = " + json.dumps(feed, indent=2, default=float) + ";\n"
    )
    dashboard_js.write_text(js_payload)

    return {
        "predictions_csv": str(pred_csv),
        "dashboard_json": str(dashboard_json),
        "dashboard_js": str(dashboard_js),
    }
