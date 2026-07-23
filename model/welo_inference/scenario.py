"""Live what-if scoring: perturb a real cohort and re-run the model.

This is what turns the agents from "describe the pre-computed numbers" into
"operate the model". Given a set of levers (cut overtime, add a rest day,
lengthen sleep, cap the leave gap, and so on), it takes the actual individual
records the model already scored, applies the change to their input features,
re-scores them through the SAME trained model, and reports the before / after
aggregates: predicted absent days, cost exposure, high or critical headcount and
mean fatigue, plus the days and Rand saved.

Everything here is deterministic and grounded on the model. There is no LLM in
this file; the agent layer calls run_scenario() as a tool, and the dashboard can
call the /scenario endpoint directly for a what-if panel.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

# Cost model, kept identical to the feed builder so scenario numbers line up
# with the rest of the dashboard.
RAND_PER_DAY = 1100.0
ADDRESSABLE = 0.20

# The levers a scenario may pull. Each is bounded so a demo cannot ask the model
# for a physically silly population (negative overtime, 20 hours of sleep). The
# model still decides what the change does to absence; we only bound the input.
#   kind "pct":   multiply the field by (1 + value/100), value in [-100, 100]
#   kind "delta": add value to the field
#   kind "set":   set the field to value
LEVERS: Dict[str, Dict[str, Any]] = {
    "overtime_pct": {
        "field": "overtime_hours_14d", "kind": "pct", "min": -100.0, "max": 100.0,
        "label": "Overtime hours (14d)", "clamp": (0.0, 90.0),
    },
    "workload_pct": {
        "field": "workload_index_current", "kind": "pct", "min": -50.0, "max": 50.0,
        "label": "Workload index", "clamp": (80.0, 380.0),
    },
    "sleep_delta": {
        "field": "sleep_hours_avg_7d", "kind": "delta", "min": -3.0, "max": 3.0,
        "label": "Sleep hours (avg 7d)", "clamp": (3.5, 10.0),
    },
    "activity_delta": {
        "field": "physical_activity_days_per_week", "kind": "delta", "min": -7.0, "max": 7.0,
        "label": "Active days per week", "clamp": (0.0, 7.0),
    },
    "consecutive_shifts_delta": {
        "field": "consecutive_shifts_worked", "kind": "delta", "min": -14.0, "max": 14.0,
        "label": "Consecutive shifts", "clamp": (0.0, 21.0),
    },
    "leave_gap_cap": {
        "field": "days_since_last_leave", "kind": "set", "min": 0.0, "max": 365.0,
        "label": "Cap days since last leave at", "clamp": (0.0, 365.0),
    },
}


# Canonical raw model inputs. The individual records in the feed carry the
# levers we tune plus most attributes, but omit a few static fields
# (height_cm, weight_kg, marital_status, ...). The feature pipeline expects every
# raw column to exist, so we pad the missing ones with None and let the model's
# imputers fill them. They are identical in baseline and scenario, so they never
# move the before / after delta.
_REQUIRED_RAW = (
    "age", "gender", "marital_status", "number_of_dependents", "number_of_children",
    "education_level", "tenure_years", "distance_from_work_km", "bmi", "height_cm",
    "weight_kg", "smoking_status", "alcohol_frequency", "physical_activity_days_per_week",
    "workload_index_current", "sleep_hours_avg_7d", "overtime_hours_14d",
    "consecutive_shifts_worked", "days_since_last_leave", "perceived_stress_score",
)


def _pad(emp: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure every raw input column exists so the feature pipeline can run."""
    out = dict(emp)
    for col in _REQUIRED_RAW:
        out.setdefault(col, None)
    return out


class ScenarioError(ValueError):
    """Bad scenario request (unknown lever, out-of-range value, empty cohort)."""


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def apply_adjustments(attrs: Dict[str, Any], adjustments: Dict[str, float]) -> Dict[str, Any]:
    """Return a copy of one employee's attributes with the levers applied."""
    out = dict(attrs)
    for name, raw in adjustments.items():
        spec = LEVERS.get(name)
        if spec is None:
            raise ScenarioError(f"Unknown lever '{name}'. Valid: {sorted(LEVERS)}")
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ScenarioError(f"Lever '{name}' needs a number, got {raw!r}.")
        if not (spec["min"] <= value <= spec["max"]):
            raise ScenarioError(
                f"Lever '{name}' must be within [{spec['min']}, {spec['max']}], got {value}."
            )
        field = spec["field"]
        cur = out.get(field)
        if cur is None:
            continue  # nothing to perturb for this record
        cur = float(cur)
        if spec["kind"] == "pct":
            new = cur * (1.0 + value / 100.0)
        elif spec["kind"] == "delta":
            new = cur + value
        else:  # "set" caps the field at value (used for the leave-gap lever)
            new = min(cur, value)
        lo, hi = spec.get("clamp", (None, None))
        if lo is not None:
            new = _clamp(new, lo, hi)
        out[field] = round(new, 2)
    return out


def _select(individuals: List[Dict[str, Any]], dimension: Optional[str],
            cohort: Optional[str]) -> List[Dict[str, Any]]:
    """Filter individuals to a cohort. Matches the cohort label the individual
    records carry (e.g. dimension 'cohort_load', cohort 'High-intensity ops').
    With no dimension/cohort, the whole scored workforce is used."""
    if not dimension or not cohort:
        return list(individuals)
    picked = [r for r in individuals
              if (r.get("cohorts") or {}).get(dimension) == cohort]
    if not picked:
        valid = sorted({(r.get("cohorts") or {}).get(dimension)
                        for r in individuals} - {None})
        raise ScenarioError(
            f"No individuals in {dimension} = '{cohort}'. Valid cohorts: {valid}"
        )
    return picked


def _aggregate(scores: List[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(scores)
    days90 = sum(float(s["predicted_absent_days_90d"]) for s in scores)
    days_annual = sum(float(s["predicted_absent_days_monthly"]) * 12.0 for s in scores)
    hi_crit = sum(1 for s in scores if str(s["predicted_risk_band"]).lower() in ("high", "critical"))
    fatigues = [float(s["fatigue_burnout_score"]) for s in scores
                if s.get("fatigue_burnout_score") is not None]
    mean_fatigue = round(sum(fatigues) / len(fatigues), 1) if fatigues else None
    return {
        "covered_lives": n,
        "predicted_absent_days_90d": round(days90, 0),
        "predicted_absent_days_annual": round(days_annual, 0),
        "cost_exposure_rand": round(days_annual * RAND_PER_DAY, 0),
        "high_or_critical_count": hi_crit,
        "high_or_critical_share": round(hi_crit / n, 4) if n else 0.0,
        "mean_fatigue": mean_fatigue,
    }


def run_scenario(
    score_fn: Callable[[List[Dict[str, Any]]], List[Dict[str, Any]]],
    individuals: List[Dict[str, Any]],
    adjustments: Dict[str, float],
    dimension: Optional[str] = None,
    cohort: Optional[str] = None,
) -> Dict[str, Any]:
    """Re-score a cohort before and after the adjustments.

    ``score_fn`` takes a list of employee dicts and returns the model's per-row
    scores (this is InferenceService.score bound by the caller). Both baseline
    and scenario are re-scored through it so the delta is apples to apples.
    """
    if not adjustments:
        raise ScenarioError("No adjustments supplied.")
    picked = _select(individuals, dimension, cohort)

    base_emps = [_pad(r.get("attrs") or {}) for r in picked]
    scen_emps = [_pad(apply_adjustments(r.get("attrs") or {}, adjustments)) for r in picked]

    base = _aggregate(score_fn(base_emps))
    scen = _aggregate(score_fn(scen_emps))

    days_saved_90d = round(base["predicted_absent_days_90d"] - scen["predicted_absent_days_90d"], 0)
    annual_days_saved = base["predicted_absent_days_annual"] - scen["predicted_absent_days_annual"]
    cost_saved = round(annual_days_saved * RAND_PER_DAY, 0)
    return {
        "cohort": {"dimension": dimension, "cohort": cohort, "covered_lives": base["covered_lives"]},
        "adjustments": adjustments,
        "baseline": base,
        "scenario": scen,
        "delta": {
            "predicted_absent_days_90d": days_saved_90d,
            "cost_saved_rand_annual": cost_saved,
            "high_or_critical_count": base["high_or_critical_count"] - scen["high_or_critical_count"],
            "days_saved_pct": round(
                days_saved_90d / base["predicted_absent_days_90d"] * 100.0, 1
            ) if base["predicted_absent_days_90d"] else 0.0,
        },
    }


def levers_spec() -> List[Dict[str, Any]]:
    """Public description of the levers, for the API and the agent tool schema."""
    return [
        {"name": k, "label": v["label"], "kind": v["kind"], "min": v["min"], "max": v["max"]}
        for k, v in LEVERS.items()
    ]
