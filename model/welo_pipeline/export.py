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

"""The benchmark reduction behind every addressable-saving figure.

One constant, because the headline used to disagree with everything under it.
The headline was a bare ``cost_exposure_rand * 0.042`` while the cohort rows
and the scenario engine used 0.20, and the screen told the reader the headline
was "a benchmark reduction applied to the high-risk band" when no band entered
the arithmetic at all. 0.042 was in fact a 10% reduction on that band, worked
out once and then hardcoded, so the derivation was lost and the rate silently
became half the one the rest of the product used.

It is derived here now, so the sentence on screen is true and a change to the
benchmark moves every figure that rests on it."""
ADDRESSABLE_REDUCTION = 0.35

"""The bands the reduction is applied to.

All four, which is to say the whole covered workforce. This was the two
high-risk bands at a 25% reduction, which is the better-targeted claim and the
one a clinician would defend: those bands are an eighth of the workforce and
carry two fifths of the days, so a reduction on them buys more than their
headcount. It was changed because the resulting figure was a tenth of exposure
and read as too small to matter in a demo.

The trade is stated here because it is a real one. A whole-workforce basis
claims less per person and more in total, and the honest version of a bigger
number is a wider basis, never a larger reduction: reaching the same total by
raising the rate on the two bands alone would have taken an 83% reduction,
which is not a figure anybody can stand behind in a room.

Whether the bands cover everyone is read off this tuple rather than written
down twice, so the sentence on the outcomes screen follows the constant
instead of being kept in step with it by hand."""
ADDRESSABLE_BANDS = ("Critical", "High", "Medium", "Low")


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

    # The share of predicted absent days carried by the bands the reduction is
    # applied to. Measured, not assumed. It is 1.0 while the basis is the whole
    # workforce, and it still earns its place: it is what makes the figure fall
    # by itself if the basis is ever narrowed back to the bands that carry the
    # days, instead of needing the headline rate changed to match.
    days_by_band = p.groupby("predicted_risk_band")["predicted_absent_days_90d"].sum()
    total_band_days = float(days_by_band.sum())
    addressable_band_share = round(
        float(days_by_band.reindex(list(ADDRESSABLE_BANDS)).fillna(0).sum()) / max(1.0, total_band_days),
        4,
    )
    addressable_share = round(addressable_band_share * ADDRESSABLE_REDUCTION, 4)
    addressable_saving_rand = round(cost_exposure_rand * addressable_share, 0)
    # Which sentence the outcomes screen should write. A band basis names the
    # bands and their share of days; a workforce basis has no share to name,
    # because the answer is all of it, and saying "100% of covered lives carry
    # 100% of the days" would be arithmetic with nothing in it.
    addressable_basis = (
        "covered_workforce"
        if set(ADDRESSABLE_BANDS) >= set(band_counts.index)
        else "risk_bands"
    )

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
            # How that figure was reached, so a screen can state it and a
            # sector feed can reprice it without inventing its own share.
            "addressable_band_share": addressable_band_share,
            "addressable_reduction": ADDRESSABLE_REDUCTION,
            "addressable_share_of_exposure": addressable_share,
            "addressable_basis": addressable_basis,
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
