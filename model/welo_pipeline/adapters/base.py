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
    # The time axis. Added in schema version 2, because the 23 scalar columns
    # below describe a workforce at one unspecified moment, which is enough to
    # target a cohort and not enough to say whether anything changed.
    #
    # period_start is the first day of the month the row describes. The grain is
    # a month: it is the cadence an employer's HR system can produce without a
    # new integration, and a shorter period on a cohort of a few thousand puts
    # too many cells under the small-cell floor to report.
    #
    # data_as_of is when the extract was taken, which is not the same thing. A
    # month's figures are restated as late certificates arrive, so a reader
    # needs to know which vintage of that month they are looking at. Without it,
    # two reports of the same month disagree and neither is wrong.
    "period_start",
    "data_as_of",
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

# The columns an adapter may not leave empty. Everything else in the canonical
# list is optional and NA-filled, because a missing body measurement is a gap
# the pipeline's imputer is designed for. These four are not gaps: without the
# period there is no time axis and no outcome can ever be measured, and without
# the identifier and the measure there is no row worth having.
REQUIRED_COLUMNS = [
    "period_start",
    "data_as_of",
    "employee_id",
    "absence_duration_hours",
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
        """Fill the optional columns, refuse to invent the required ones.

        NA-filling everything was the old behaviour and it was fine while the
        schema was a single undated snapshot: a missing height_cm is a gap the
        imputer handles. It stopped being fine when the time axis arrived. An
        extract with no period would have passed ingest and produced an undated
        dataset that looks complete, and the first thing anyone would notice is
        an outcome report that cannot be computed, months later, with nobody
        able to say which month the numbers belong to.

        So the columns that make a row locatable and usable are required, and an
        adapter that cannot supply them says so here rather than downstream.
        """
        absent = [c for c in REQUIRED_COLUMNS if c not in df.columns]
        if absent:
            raise ValueError(
                f"{self.name}: extract is missing required columns {absent}. "
                "period_start and data_as_of carry the time axis, without which "
                "no change can be measured; employee_id and "
                "absence_duration_hours are the unit and the measure. An "
                "adapter for a source that genuinely has no period must set one "
                "explicitly and say so, rather than leaving it empty."
            )

        empty = [c for c in REQUIRED_COLUMNS if df[c].isna().all()]
        if empty:
            raise ValueError(
                f"{self.name}: required columns {empty} are present but entirely "
                "empty. A column that looks like a time axis and carries nothing "
                "is worse than no column at all."
            )

        for col in CANONICAL_COLUMNS:
            if col not in df.columns:
                df[col] = pd.NA
        return df[CANONICAL_COLUMNS].copy()
