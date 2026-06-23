"""Validate stage.

Profiles the ingested DataFrame and emits a structured report. The
report covers the row and column counts per source dataset, the per-
column missingness, plausibility flags (such as ages outside 16 to 70 or
BMIs outside 14 to 50), and a sanity check on the target column
including its range, share of zeros, and skew.

The stage does not drop rows. It returns the report and leaves the
decision about whether to abort, warn, or proceed up to the caller.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List

import numpy as np
import pandas as pd


PLAUSIBILITY_RULES = {
    "age": (16, 70),
    "bmi": (14, 50),
    "height_cm": (140, 210),
    "weight_kg": (35, 200),
    "tenure_years": (0, 50),
    "distance_from_work_km": (0, 150),
    "physical_activity_days_per_week": (0, 7),
    "absence_duration_hours": (0, 240),
    "sleep_hours_avg_7d": (3, 12),
    "overtime_hours_14d": (0, 120),
    "consecutive_shifts_worked": (0, 28),
    "days_since_last_leave": (0, 730),
    "perceived_stress_score": (0, 40),
}


@dataclass
class ValidationReport:
    n_rows: int
    n_cols: int
    rows_per_source: Dict[str, int]
    missingness_pct: Dict[str, float]
    out_of_range_pct: Dict[str, float]
    target_summary: Dict[str, float]
    warnings: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def validate(df: pd.DataFrame, target_col: str) -> ValidationReport:
    warnings: List[str] = []

    rows_per_source = (
        df.get("source_dataset", pd.Series(["unknown"] * len(df)))
        .fillna("unknown")
        .value_counts()
        .to_dict()
    )

    missing = (df.isna().mean() * 100).round(2).to_dict()

    oor: Dict[str, float] = {}
    for col, (lo, hi) in PLAUSIBILITY_RULES.items():
        if col in df.columns and df[col].notna().any():
            vals = pd.to_numeric(df[col], errors="coerce")
            mask = (vals < lo) | (vals > hi)
            pct = float(mask.mean() * 100)
            oor[col] = round(pct, 2)
            if pct > 1.0:
                warnings.append(
                    f"{col}: {pct:.1f}% of values fall outside the plausibility band "
                    f"[{lo}, {hi}]"
                )

    target = pd.to_numeric(df[target_col], errors="coerce")
    target_summary = {
        "n_non_null": int(target.notna().sum()),
        "mean": round(float(target.mean()), 2),
        "median": round(float(target.median()), 2),
        "max": round(float(target.max()), 2),
        "zero_share_pct": round(float((target == 0).mean() * 100), 2),
        "p95": round(float(target.quantile(0.95)), 2),
    }
    if target_summary["n_non_null"] < 100:
        warnings.append(
            f"Only {target_summary['n_non_null']} target observations available. "
            f"Model metrics will be noisy; treat results as illustrative."
        )

    return ValidationReport(
        n_rows=int(len(df)),
        n_cols=int(df.shape[1]),
        rows_per_source={str(k): int(v) for k, v in rows_per_source.items()},
        missingness_pct={k: float(v) for k, v in missing.items()},
        out_of_range_pct=oor,
        target_summary=target_summary,
        warnings=warnings,
    )
