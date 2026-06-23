"""Glencore adapter stub.

When the live Glencore feed lands, only two things need to change. The
``load`` method below is implemented to read whatever shape Glencore
ships (a CSV export, an HRIS pull, Parquet, and so on) and rename the
columns to the canonical Welo schema, and ``configs/glencore.yaml``
points the pipeline at this adapter in place of ``uci`` plus
``synthetic_mining``. Everything downstream, from feature engineering
through model training to the dashboard JSON, stays exactly as it is.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .base import BaseAdapter


class GlencoreAdapter(BaseAdapter):
    name = "glencore"

    def __init__(self, path: str | Path | None = None, **kwargs) -> None:
        super().__init__(**kwargs)
        self.path = Path(path) if path else None

    def load(self) -> pd.DataFrame:
        if self.path is None or not self.path.exists():
            raise NotImplementedError(
                "GlencoreAdapter is a stub. When the client feed lands, "
                "implement load() to read it, rename columns to the canonical "
                "schema (see adapters/base.CANONICAL_COLUMNS), and return."
            )

        df = pd.read_csv(self.path)
        rename_map = {
            "EmployeeID": "employee_id",
            "Age": "age",
            "Gender": "gender",
            "MaritalStatus": "marital_status",
            "Dependents": "number_of_dependents",
            "Children": "number_of_children",
            "Education": "education_level",
            "YearsOfService": "tenure_years",
            "CommuteKm": "distance_from_work_km",
            "BMI": "bmi",
            "HeightCm": "height_cm",
            "WeightKg": "weight_kg",
            "Smoker": "smoking_status",
            "Alcohol": "alcohol_frequency",
            "ActivityDays": "physical_activity_days_per_week",
            "ShiftLoadIndex": "workload_index_current",
            "SleepHoursAvg7d": "sleep_hours_avg_7d",
            "OvertimeHours14d": "overtime_hours_14d",
            "ConsecutiveShifts": "consecutive_shifts_worked",
            "DaysSinceLeave": "days_since_last_leave",
            "PSS10Score": "perceived_stress_score",
            "AbsentHours90d": "absence_duration_hours",
        }
        df = df.rename(columns=rename_map)
        df["source_dataset"] = "glencore_live_v1"
        return self._coerce_to_canonical(df)
