"""Sector-calibrated synthetic cohorts.

Same data-generating process as the mining cohort (so the model's learned
relationships between risk factors and absence are preserved) but with the
INPUT distributions re-calibrated to each sector's workforce norms. Only the
population changes, not the model.

The calibrations are illustrative, anchored to plausible South African
sector norms (sedentary line/driving work carries higher BMI; logistics runs
longer hours and worse sleep; manufacturing is lighter and more stable than
deep-level mining). They stay illustrative until real client data lands, and
every row is tagged with its sector source_dataset so it can be filtered out.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

# Baseline knobs match welo_pipeline.adapters.synthetic (the mining cohort).
_BASE = dict(
    age_mean=38.0, age_std=9.0, gender_m=0.82,
    smoking_p=[0.42, 0.20, 0.13, 0.25],      # Never/Former/Occasional/Daily
    alcohol_p=[0.30, 0.40, 0.22, 0.08],      # Never/Occasionally/Regularly/Heavy
    activity_mean=2.1, workload_mean=220.0, workload_std=45.0,
    sleep_mean=6.4, overtime_scale=12.0, consec_lambda=7,
    bmi_mean=27.4, distance_scale=8.0, tenure_shape=2.2, tenure_scale=3.4,
)

SECTOR_PROFILES = {
    "manufacturing": {**_BASE, **dict(
        label="manufacturing_sa", emp_base=200_000,
        age_mean=39.0, gender_m=0.72,
        smoking_p=[0.48, 0.20, 0.14, 0.18],
        alcohol_p=[0.34, 0.42, 0.18, 0.06],
        activity_mean=2.4, workload_mean=200.0, workload_std=40.0,
        sleep_mean=6.6, overtime_scale=10.0, consec_lambda=6,
        bmi_mean=28.2, distance_scale=7.0, tenure_shape=2.6, tenure_scale=3.6,
    )},
    "logistics": {**_BASE, **dict(
        label="logistics_sa", emp_base=300_000,
        age_mean=41.0, gender_m=0.86,
        smoking_p=[0.40, 0.18, 0.14, 0.28],
        alcohol_p=[0.28, 0.40, 0.22, 0.10],
        activity_mean=1.8, workload_mean=210.0, workload_std=50.0,
        sleep_mean=6.1, overtime_scale=14.0, consec_lambda=8,
        bmi_mean=28.8, distance_scale=10.0, tenure_shape=2.0, tenure_scale=3.2,
    )},
}


def generate_cohort(sector: str, n_rows: int = 6000, random_seed: int = 7) -> pd.DataFrame:
    p = SECTOR_PROFILES[sector]
    rng = np.random.default_rng(random_seed)
    n = int(n_rows)

    age = np.clip(rng.normal(p["age_mean"], p["age_std"], n), 19, 62).round().astype(int)
    gender = rng.choice(["M", "F"], size=n, p=[p["gender_m"], 1 - p["gender_m"]])
    marital = rng.choice(["Single", "Married", "Divorced", "Widowed"], size=n, p=[0.30, 0.55, 0.12, 0.03])
    deps = rng.poisson(lam=1.6, size=n).clip(0, 8)
    kids = np.minimum(deps, rng.poisson(lam=1.2, size=n)).clip(0, 6)
    education = rng.choice(["Primary", "Secondary", "Diploma", "Tertiary"], size=n, p=[0.18, 0.55, 0.20, 0.07])
    tenure = np.clip(rng.gamma(shape=p["tenure_shape"], scale=p["tenure_scale"], size=n), 0, 35).round(1)
    distance = np.clip(rng.gamma(shape=2.0, scale=p["distance_scale"], size=n), 0.5, 80).round(1)

    height_cm = np.where(gender == "M", rng.normal(170, 7, n), rng.normal(159, 6, n)).clip(145, 200)
    bmi = np.clip(rng.normal(p["bmi_mean"], 4.6, n), 16, 47)
    weight_kg = (bmi * (height_cm / 100) ** 2).round(1)
    height_cm = height_cm.round(1)
    bmi = bmi.round(1)

    smoking = rng.choice(["Never", "Former", "Occasional", "Daily"], size=n, p=p["smoking_p"])
    alcohol = rng.choice(["Never", "Occasionally", "Regularly", "Heavy"], size=n, p=p["alcohol_p"])
    activity = np.clip(rng.normal(p["activity_mean"], 1.6, n), 0, 7).round().astype(int)
    workload = np.clip(rng.normal(p["workload_mean"], p["workload_std"], n), 80, 380).round(2)

    sleep_hours = np.clip(rng.normal(p["sleep_mean"], 1.1, n), 3.5, 10.0).round(2)
    overtime_14d = np.clip(rng.gamma(shape=1.6, scale=p["overtime_scale"], size=n), 0, 90).round(1)
    consecutive_shifts = rng.poisson(lam=p["consec_lambda"], size=n).clip(0, 21).astype(int)
    days_since_leave = np.clip(rng.gamma(shape=2.0, scale=55, size=n), 0, 365).round().astype(int)

    # Fatigue composite and absence DGP: identical to the mining generator.
    sleep_deficit = np.clip(6.5 - sleep_hours, 0, None)
    overtime_contrib = np.minimum(overtime_14d / 40.0 * 25.0, 25.0)
    shift_contrib = np.minimum(consecutive_shifts / 14.0 * 15.0, 15.0)
    leave_contrib = np.minimum(days_since_leave / 180.0 * 15.0, 15.0)
    workload_contrib = np.clip((workload - 240) / 5.0, 0, 20)
    fatigue_noise = rng.normal(0, 6.0, n)
    fatigue = np.clip(18.0 + sleep_deficit * 6.5 + overtime_contrib + shift_contrib
                      + leave_contrib + workload_contrib + fatigue_noise, 0, 100).round(1)

    pss_noise = rng.normal(0, 4.0, n)
    perceived_stress = np.clip(8 + 0.28 * fatigue + pss_noise, 0, 40).round().astype(int)

    bmi_z = (bmi - 27.4) / 4.6
    age_z = (age - 38) / 9.0
    workload_z = (workload - 220) / 45.0
    fatigue_z = (fatigue - 50) / 18.0
    smoke_eff = pd.Series(smoking).map({"Never": 0.0, "Former": 0.4, "Occasional": 1.0, "Daily": 2.1}).to_numpy()
    alcohol_eff = pd.Series(alcohol).map({"Never": 0.0, "Occasionally": 0.1, "Regularly": 0.7, "Heavy": 1.9}).to_numpy()
    activity_eff = -0.25 * activity
    distance_eff = 0.025 * distance

    latent = (1.2 + 0.7 * bmi_z + 0.5 * age_z + 0.5 * workload_z + 1.1 * fatigue_z
              + smoke_eff + alcohol_eff + activity_eff + distance_eff + 0.1 * deps)
    noise = rng.normal(0, 0.55, n)
    mu = np.exp(latent / 1.5 + noise)
    absence_hours = np.clip(mu, 0, 120).round().astype(float)
    zero_mask = rng.random(n) < 0.18
    absence_hours = np.where(zero_mask, 0.0, absence_hours)

    df = pd.DataFrame({
        "employee_id": np.arange(p["emp_base"], p["emp_base"] + n),
        "age": age, "gender": gender, "marital_status": marital,
        "number_of_dependents": deps, "number_of_children": kids,
        "education_level": education, "tenure_years": tenure,
        "distance_from_work_km": distance, "bmi": bmi, "height_cm": height_cm, "weight_kg": weight_kg,
        "smoking_status": smoking, "alcohol_frequency": alcohol,
        "physical_activity_days_per_week": activity, "workload_index_current": workload,
        "sleep_hours_avg_7d": sleep_hours, "overtime_hours_14d": overtime_14d,
        "consecutive_shifts_worked": consecutive_shifts, "days_since_last_leave": days_since_leave,
        "perceived_stress_score": perceived_stress, "absence_duration_hours": absence_hours,
        "source_dataset": f"synthetic_{p['label']}",
    })
    return df
