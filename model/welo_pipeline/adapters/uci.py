"""UCI absenteeism adapter.

Reads the UCI subset out of the supplied CSV export, keeps only rows
flagged ``uci_absenteeism`` (the other source_dataset values are empty
on the absence target), and returns the canonical schema.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .base import BaseAdapter


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
        return self._coerce_to_canonical(df)
