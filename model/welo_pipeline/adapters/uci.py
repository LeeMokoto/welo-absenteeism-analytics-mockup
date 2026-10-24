"""UCI absenteeism adapter.

Reads the UCI subset out of the supplied CSV export, keeps only rows
flagged ``uci_absenteeism`` (the other source_dataset values are empty
on the absence target), and returns the canonical schema.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .base import BaseAdapter


# The documented start of the UCI absenteeism dataset's collection window.
UCI_WINDOW_START = "2007-07-01"


class UCIAdapter(BaseAdapter):
    name = "uci"

    def __init__(self, path: str | Path = "welo_export.csv", **kwargs) -> None:
        super().__init__(**kwargs)
        self.path = Path(path)

    def load(self) -> pd.DataFrame:
        df = pd.read_csv(self.path)
        if "source_dataset" in df.columns:
            df = df[df["source_dataset"] == "uci_absenteeism"].copy()

        df = df.replace({"": pd.NA})

        for col in (
            "age", "number_of_dependents", "number_of_children", "tenure_years",
            "distance_from_work_km", "bmi", "height_cm", "weight_kg",
            "physical_activity_days_per_week", "absence_duration_hours",
            "workload_index_current",
            "sleep_hours_avg_7d", "overtime_hours_14d",
            "consecutive_shifts_worked", "days_since_last_leave",
            "perceived_stress_score",
        ):
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        df = df.dropna(subset=["absence_duration_hours"]).reset_index(drop=True)

        # The UCI absenteeism dataset carries no usable date: it is a published
        # research extract covering a Brazilian courier company over 2007 to
        # 2010, and the per-row month is a categorical with no year. Rather than
        # leave the time axis empty, which the base adapter now refuses, it is
        # set explicitly to the start of the dataset's documented window and
        # labelled as such by source_dataset. These 200 rows are a pipeline
        # demonstration, not part of any tenant's series, and nothing in outcome
        # tracking should ever read them as one period of a trend.
        if "period_start" not in df.columns or df["period_start"].isna().all():
            df["period_start"] = UCI_WINDOW_START
        if "data_as_of" not in df.columns or df["data_as_of"].isna().all():
            df["data_as_of"] = UCI_WINDOW_START

        return self._coerce_to_canonical(df)
