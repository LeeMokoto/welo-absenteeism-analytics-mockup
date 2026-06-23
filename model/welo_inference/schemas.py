"""Request and response schemas for the inference API.

These are deliberately tight so the auto-generated OpenAPI docs at
``/docs`` end up being useful documentation in their own right. The
models target Pydantic v2.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, ConfigDict


class EmployeeInput(BaseModel):
    """One employee record in the canonical Welo schema.

    Every field is optional and the pipeline will impute anything that is
    missing. Fatigue inputs (sleep, overtime, and the rest) are strongly
    recommended, because without them the fatigue lever lands on a
    neutral value rather than reflecting the real workforce signal.
    """

    model_config = ConfigDict(extra="allow")

    employee_id: Optional[int] = Field(default=None, description="Stable client-side ID")
    age: Optional[int] = None
    gender: Optional[str] = None
    marital_status: Optional[str] = None
    number_of_dependents: Optional[int] = None
    number_of_children: Optional[int] = None
    education_level: Optional[str] = None
    tenure_years: Optional[float] = None
    distance_from_work_km: Optional[float] = None
    bmi: Optional[float] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    smoking_status: Optional[str] = Field(
        default=None, description="One of: Never, Former, Occasional, Daily"
    )
    alcohol_frequency: Optional[str] = Field(
        default=None, description="One of: Never, Occasionally, Regularly, Heavy"
    )
    physical_activity_days_per_week: Optional[int] = None
    workload_index_current: Optional[float] = None
    sleep_hours_avg_7d: Optional[float] = None
    overtime_hours_14d: Optional[float] = None
    consecutive_shifts_worked: Optional[int] = None
    days_since_last_leave: Optional[int] = None
    perceived_stress_score: Optional[int] = Field(default=None, description="PSS-10 (0 to 40)")


class ScoreRequest(BaseModel):
    employees: List[EmployeeInput] = Field(..., min_length=1)
    include_reasons: bool = Field(
        default=False, description="If true, include SHAP-derived top reasons per employee."
    )


class TopReason(BaseModel):
    feature: str
    label: str
    shap_hours: float


class EmployeeScore(BaseModel):
    employee_id: Optional[int] = None
    predicted_absent_hours: float
    predicted_absent_days_monthly: float
    predicted_absent_days_90d: float
    predicted_risk_band: str
    probabilities: Dict[str, float]
    fatigue_burnout_score: Optional[float] = None
    fatigue_band: Optional[str] = None
    top_reasons: Optional[List[TopReason]] = None


class ScoreResponse(BaseModel):
    model_version: str
    horizon_days: int
    predictions: List[EmployeeScore]


class HealthResponse(BaseModel):
    status: str
    version: str
    model_loaded: bool


class MetadataResponse(BaseModel):
    run_name: str
    model_version: str
    feature_names: List[str]
    class_labels: List[str]
    metrics: Dict[str, Any]
    data_provenance: List[Dict[str, Any]]
