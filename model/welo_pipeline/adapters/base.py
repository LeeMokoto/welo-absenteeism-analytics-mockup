"""Adapter contract.

Every adapter returns a DataFrame in the Welo canonical schema (see
``CANONICAL_COLUMNS``). The pipeline never sees source-specific columns:
the adapter is responsible for renaming, recoding and filling defaults.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import pandas as pd

CANONICAL_COLUMNS = [
    "employee_id",
    "age",
    "gender",
    "marital_status",
    "number_of_dependents",
    "number_of_children",
    "education_level",
    "tenure_years",
    "distance_from_work_km",
    "bmi",
    "height_cm",
    "weight_kg",
    "smoking_status",
    "alcohol_frequency",
    "physical_activity_days_per_week",
    "workload_index_current",
    "sleep_hours_avg_7d",
    "overtime_hours_14d",
    "consecutive_shifts_worked",
    "days_since_last_leave",
    "perceived_stress_score",
    "absence_duration_hours",
    "source_dataset",
]


class BaseAdapter(ABC):
    """Subclasses must implement ``load`` returning a canonical DataFrame."""

    name: str = "base"

    def __init__(self, **kwargs: Any) -> None:
        self.options = kwargs

    @abstractmethod
    def load(self) -> pd.DataFrame:  # pragma: no cover - abstract
        ...

    def _coerce_to_canonical(self, df: pd.DataFrame) -> pd.DataFrame:
        missing = [c for c in CANONICAL_COLUMNS if c not in df.columns]
        for col in missing:
            df[col] = pd.NA
        return df[CANONICAL_COLUMNS].copy()
