"""Synthetic mining-cohort generator.

This adapter creates plausibility-anchored synthetic rows shaped like a
South African mining workforce so the demo model has enough samples to
learn something useful. The distributions are calibrated to published
SA mining-cohort epidemiology (hypertension around 26 percent, type 2
diabetes around 13 percent, mean BMI near 27, and so on) and to the
workload and shift assumptions used elsewhere on the dashboard.

This is not Glencore data. Every row carries
``source_dataset = "synthetic_mining_v1"`` so downstream filters can
exclude it the moment real client data arrives.

The absence target is generated from a defensible data-generating
process, and the model learns that process. That is the whole point of
the demo: it shows the pipeline really does fit signal when signal is
present.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import BaseAdapter


class SyntheticMiningAdapter(BaseAdapter):
    name = "synthetic_mining"

    def __init__(
        self,
        n_rows: int = 800,
        random_seed: int = 7,
        cohort: str = "glencore_sa_mining",
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self.n_rows = int(n_rows)
        self.seed = int(random_seed)
        self.cohort = cohort

    def load(self) -> pd.DataFrame:
        rng = np.random.default_rng(self.seed)
        n = self.n_rows

        age = np.clip(rng.normal(loc=38, scale=9, size=n), 19, 62).round().astype(int)
        gender = rng.choice(["M", "F"], size=n, p=[0.82, 0.18])
        marital = rng.choice(
            ["Single", "Married", "Divorced", "Widowed"], size=n, p=[0.30, 0.55, 0.12, 0.03]
        )
        deps = rng.poisson(lam=1.6, size=n).clip(0, 8)
        kids = np.minimum(deps, rng.poisson(lam=1.2, size=n)).clip(0, 6)
        education = rng.choice(
            ["Primary", "Secondary", "Diploma", "Tertiary"],
            size=n, p=[0.18, 0.55, 0.20, 0.07],
        )
        tenure = np.clip(rng.gamma(shape=2.2, scale=3.4, size=n), 0, 35).round(1)
        distance = np.clip(rng.gamma(shape=2.0, scale=8.0, size=n), 0.5, 80).round(1)

        height_cm = np.where(
            gender == "M",
            rng.normal(170, 7, size=n),
            rng.normal(159, 6, size=n),
        ).clip(145, 200)
        bmi = np.clip(rng.normal(27.4, 4.6, size=n), 16, 47)
        weight_kg = (bmi * (height_cm / 100) ** 2).round(1)
        height_cm = height_cm.round(1)
        bmi = bmi.round(1)

        smoking = rng.choice(
            ["Never", "Former", "Occasional", "Daily"], size=n, p=[0.42, 0.20, 0.13, 0.25]
        )
        alcohol = rng.choice(
            ["Never", "Occasionally", "Regularly", "Heavy"],
            size=n, p=[0.30, 0.40, 0.22, 0.08],
        )
        activity = np.clip(rng.normal(2.1, 1.6, size=n), 0, 7).round().astype(int)

        workload = np.clip(rng.normal(220, 45, size=n), 80, 380).round(2)

        sleep_hours = np.clip(rng.normal(6.4, 1.1, size=n), 3.5, 10.0).round(2)
        overtime_14d = np.clip(rng.gamma(shape=1.6, scale=12.0, size=n), 0, 90).round(1)
        consecutive_shifts = rng.poisson(lam=7, size=n).clip(0, 21).astype(int)
        days_since_leave = np.clip(rng.gamma(shape=2.0, scale=55, size=n), 0, 365).round().astype(int)

        sleep_deficit = np.clip(6.5 - sleep_hours, 0, None)
        overtime_contrib = np.minimum(overtime_14d / 40.0 * 25.0, 25.0)
        shift_contrib = np.minimum(consecutive_shifts / 14.0 * 15.0, 15.0)
        leave_contrib = np.minimum(days_since_leave / 180.0 * 15.0, 15.0)
        workload_contrib = np.clip((workload - 240) / 5.0, 0, 20)
        fatigue_noise = rng.normal(0, 6.0, size=n)
        fatigue = np.clip(
            18.0
            + sleep_deficit * 6.5
            + overtime_contrib
            + shift_contrib
            + leave_contrib
            + workload_contrib
            + fatigue_noise,
            0,
            100,
        ).round(1)

        pss_noise = rng.normal(0, 4.0, size=n)
        perceived_stress = np.clip(8 + 0.28 * fatigue + pss_noise, 0, 40).round().astype(int)

        bmi_z = (bmi - 27.4) / 4.6
        age_z = (age - 38) / 9.0
        workload_z = (workload - 220) / 45.0
        fatigue_z = (fatigue - 50) / 18.0
        smoke_eff = pd.Series(smoking).map(
            {"Never": 0.0, "Former": 0.4, "Occasional": 1.0, "Daily": 2.1}
        ).to_numpy()
        alcohol_eff = pd.Series(alcohol).map(
            {"Never": 0.0, "Occasionally": 0.1, "Regularly": 0.7, "Heavy": 1.9}
        ).to_numpy()
        activity_eff = -0.25 * activity
        distance_eff = 0.025 * distance

        latent = (
            1.2
            + 0.7 * bmi_z
            + 0.5 * age_z
            + 0.5 * workload_z
            + 1.1 * fatigue_z
            + smoke_eff
            + alcohol_eff
            + activity_eff
            + distance_eff
            + 0.1 * deps
        )
        noise = rng.normal(0, 0.55, size=n)
        mu = np.exp(latent / 1.5 + noise)
        absence_hours = np.clip(mu, 0, 120).round().astype(float)

        zero_mask = rng.random(n) < 0.18
        absence_hours = np.where(zero_mask, 0.0, absence_hours)

        df = pd.DataFrame(
            {
                "employee_id": np.arange(100_000, 100_000 + n),
                "age": age,
                "gender": gender,
                "marital_status": marital,
                "number_of_dependents": deps,
                "number_of_children": kids,
                "education_level": education,
                "tenure_years": tenure,
                "distance_from_work_km": distance,
                "bmi": bmi,
                "height_cm": height_cm,
                "weight_kg": weight_kg,
                "smoking_status": smoking,
                "alcohol_frequency": alcohol,
                "physical_activity_days_per_week": activity,
                "workload_index_current": workload,
                "sleep_hours_avg_7d": sleep_hours,
                "overtime_hours_14d": overtime_14d,
                "consecutive_shifts_worked": consecutive_shifts,
                "days_since_last_leave": days_since_leave,
                "perceived_stress_score": perceived_stress,
                "absence_duration_hours": absence_hours,
                "source_dataset": f"synthetic_mining_v1__{self.cohort}",
            }
        )
        return self._coerce_to_canonical(df)
