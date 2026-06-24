"""Enrich the model's dashboard feed with cohort aggregates and per-individual
records, computed from the real model predictions joined to the deterministic
synthetic cohort attributes (seed 7, n=5800, validated to match predictions
1:1 on actual absence hours).

Adds three keys to the existing feed:
  - cohort_dimensions : list of the dimensions you can group the workforce by
  - cohorts           : aggregates per cohort, per dimension (model-driven)
  - individuals       : per-employee records for the drill-down (all High/
                        Critical plus a representative sample of the rest)

Headline / risk / fatigue / intervention_queue / SHAP importance / metrics are
preserved untouched from the model export.
"""
from __future__ import annotations
import os, sys, json
import numpy as np
import pandas as pd

# Run from anywhere; paths resolve relative to this file (the model/ dir).
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from welo_pipeline.adapters.synthetic import SyntheticMiningAdapter

HOURS_PER_DAY = 8.0
RAND_PER_DAY = 1100.0
ADDRESSABLE = 0.20  # benchmark reduction on attributable absence

# ---- load real model output + reproduce attributes -------------------------
preds = pd.read_csv(f"{ROOT}/data/outputs/predictions.csv")
syn = SyntheticMiningAdapter(n_rows=5800, random_seed=7,
                             cohort="glencore_sa_mining").load()
df = preds.merge(syn, on="employee_id", how="left", suffixes=("", "_attr"))
syn_mask = df["source_dataset"].str.startswith("synthetic").fillna(False)
df = df[syn_mask].copy()  # cohort/individual views use the mining cohort
assert (df["actual_absent_hours"].round() == df["absence_duration_hours"].round()).all()

# ---- derived cohort dimensions ---------------------------------------------
def band(series, edges, labels):
    return pd.cut(series, bins=edges, labels=labels, include_lowest=True, right=False)

# Operational load: composite of workload, overtime and consecutive shifts.
wl_z = (df["workload_index_current"] - df["workload_index_current"].mean()) / df["workload_index_current"].std()
ot_z = (df["overtime_hours_14d"] - df["overtime_hours_14d"].mean()) / df["overtime_hours_14d"].std()
cs_z = (df["consecutive_shifts_worked"] - df["consecutive_shifts_worked"].mean()) / df["consecutive_shifts_worked"].std()
load_score = (wl_z + ot_z + cs_z)
df["cohort_load"] = np.where(load_score > 0.6, "High-intensity ops",
                     np.where(load_score < -0.4, "Light duty", "Standard ops"))

df["cohort_age"] = band(df["age"], [0, 30, 40, 50, 200],
                        ["Under 30", "30–39", "40–49", "50+"]).astype(str)
df["cohort_tenure"] = band(df["tenure_years"], [0, 2, 5, 10, 100],
                           ["New (<2y)", "Established (2–5y)", "Experienced (5–10y)", "Veteran (10y+)"]).astype(str)
df["cohort_fatigue"] = df["fatigue_band"].str.capitalize()
df["cohort_lifestyle"] = np.where(
    df["smoking_status"].isin(["Daily", "Occasional"]) & df["alcohol_frequency"].isin(["Regularly", "Heavy"]),
    "Smoker + drinker",
    np.where(df["smoking_status"].isin(["Daily", "Occasional"]), "Smoker",
    np.where(df["alcohol_frequency"].isin(["Regularly", "Heavy"]), "Regular drinker", "Low lifestyle risk")))

DIMENSIONS = [
    {"key": "cohort_load",      "label": "Operational load",
     "order": ["High-intensity ops", "Standard ops", "Light duty"],
     "blurb": "Composite of workload index, 14-day overtime and consecutive shifts worked, the operational levers Welo can act on with rostering."},
    {"key": "cohort_fatigue",   "label": "Fatigue / burnout band",
     "order": ["Critical", "High", "Moderate", "Low"],
     "blurb": "Composite fatigue & burnout score band, the single strongest driver in the model."},
    {"key": "cohort_age",       "label": "Age band",
     "order": ["Under 30", "30–39", "40–49", "50+"],
     "blurb": "Age cohort. Metabolic and chronic-disease risk rises with age."},
    {"key": "cohort_tenure",    "label": "Tenure band",
     "order": ["New (<2y)", "Established (2–5y)", "Experienced (5–10y)", "Veteran (10y+)"],
     "blurb": "Time in service: onboarding strain vs. long-service chronic load."},
    {"key": "cohort_lifestyle", "label": "Lifestyle risk",
     "order": ["Smoker + drinker", "Smoker", "Regular drinker", "Low lifestyle risk"],
     "blurb": "Smoking and alcohol load; together the top SHAP driver of predicted absence."},
]

DRIVER_BY_DIM = {  # crude "top driver" attribution for the cohort card headline
}

def cohort_rows(dim_key, order):
    rows = []
    g = df.groupby(dim_key, observed=True)
    for label in order:
        if label not in g.groups:
            continue
        sub = df.loc[g.groups[label]]
        n = len(sub)
        days90 = float(sub["predicted_absent_days_90d"].sum())
        days_annual = float(sub["predicted_absent_days_monthly"].sum() * 12)
        hi = int(sub["predicted_risk_band"].isin(["Critical", "High"]).sum())
        rows.append({
            "key": label,
            "label": label,
            "count": n,
            "predicted_absent_days_90d": round(days90, 0),
            "predicted_absent_days_annual": round(days_annual, 0),
            "cost_exposure_rand": round(days_annual * RAND_PER_DAY, 0),
            "addressable_saving_rand": round(days90 * RAND_PER_DAY * ADDRESSABLE, 0),
            "absent_days_per_head_annual": round(days_annual / max(1, n), 1),
            "high_or_critical_count": hi,
            "high_or_critical_share": round(hi / max(1, n), 4),
            "mean_fatigue": round(float(sub["fatigue_burnout_score"].mean()), 1),
            "risk_counts": {
                b: int((sub["predicted_risk_band"] == b).sum())
                for b in ["Critical", "High", "Medium", "Low"]
            },
        })
    return rows

cohorts = {d["key"]: cohort_rows(d["key"], d["order"]) for d in DIMENSIONS}

# ---- per-individual records + indicative drivers ---------------------------
# Indicative drivers: model features standing above the cohort norm, ordered by
# the model's own global SHAP importance. The top-20 intervention queue keeps
# true SHAP reasons; everywhere else we surface "what's elevated".
feat = {
    "fatigue_burnout_score":            ("Fatigue / burnout elevated", False),
    "workload_index_current":           ("Workload index elevated", False),
    "overtime_hours_14d":               ("Overtime hours (14d)", False),
    "consecutive_shifts_worked":        ("Consecutive shifts", False),
    "bmi":                              ("BMI", False),
    "physical_activity_days_per_week":  ("Low physical activity", True),
    "distance_from_work_km":            ("Commute distance", False),
    "perceived_stress_score":           ("Perceived stress (PSS-10)", False),
}
stats = {c: (df[c].mean(), df[c].std() or 1.0) for c in feat}

def drivers_for(row):
    out = []
    for col, (label, invert) in feat.items():
        mu, sd = stats[col]
        z = (row[col] - mu) / sd
        if invert:
            z = -z
        if z > 0.4:
            sev = "high" if z > 1.2 else ("medium" if z > 0.75 else "low")
            out.append((z, {"label": label, "severity": sev,
                            "value": round(float(row[col]), 1)}))
    out.sort(key=lambda t: -t[0])
    return [o[1] for o in out[:3]]

# SHAP reasons from the model feed, keyed by row_id, for the rows that have them
feed = json.load(open(f"{ROOT}/data/outputs/dashboard_feed.json"))
shap_by_row = {r["row_id"]: r.get("top_reasons", []) for r in feed.get("intervention_queue", [])}

attr_cols = ["age", "gender", "tenure_years", "bmi", "smoking_status",
             "alcohol_frequency", "physical_activity_days_per_week",
             "workload_index_current", "overtime_hours_14d",
             "consecutive_shifts_worked", "sleep_hours_avg_7d",
             "days_since_last_leave", "distance_from_work_km",
             "perceived_stress_score", "number_of_dependents"]

def make_individual(row):
    rec = {
        "employee_id": int(row["employee_id"]),
        "row_id": int(row["row_id"]),
        "risk_band": row["predicted_risk_band"],
        "predicted_absent_hours": round(float(row["predicted_absent_hours"]), 1),
        "predicted_absent_days_90d": round(float(row["predicted_absent_days_90d"]), 1),
        "predicted_absent_days_annual": round(float(row["predicted_absent_days_monthly"] * 12), 1),
        "fatigue_burnout_score": round(float(row["fatigue_burnout_score"]), 1),
        "fatigue_band": row["fatigue_band"],
        "prob": {
            "Critical": round(float(row["prob_critical"]), 3),
            "High": round(float(row["prob_high"]), 3),
            "Medium": round(float(row["prob_medium"]), 3),
            "Low": round(float(row["prob_low"]), 3),
        },
        "cohorts": {d["key"]: row[d["key"]] for d in DIMENSIONS},
        "attrs": {c: (round(float(row[c]), 1) if isinstance(row[c], (int, float, np.floating, np.integer)) else row[c]) for c in attr_cols},
        "drivers": drivers_for(row),
    }
    sh = shap_by_row.get(int(row["row_id"]))
    if sh:
        rec["top_reasons"] = sh
    return rec

# All High + Critical, plus a representative sample of Medium/Low for browsing.
hi = df[df["predicted_risk_band"].isin(["Critical", "High"])]
rest = df[df["predicted_risk_band"].isin(["Medium", "Low"])].sample(
    n=min(400, len(df)), random_state=7)
keep = pd.concat([hi, rest]).sort_values("predicted_absent_days_90d", ascending=False)
individuals = [make_individual(r) for _, r in keep.iterrows()]

print("cohort dims:", [d["key"] for d in DIMENSIONS])
for d in DIMENSIONS:
    print("\n==", d["label"], "==")
    for c in cohorts[d["key"]]:
        print(f"  {c['label']:>20}  n={c['count']:>4}  hi/crit={c['high_or_critical_share']*100:4.1f}%  "
              f"days/head/yr={c['absent_days_per_head_annual']:5.1f}  meanFatigue={c['mean_fatigue']}")
print("\nindividuals shipped:", len(individuals),
      "(High/Crit:", len(hi), "+ sample:", len(rest), ")")

# ---- HR & operational aggregates (for the HR & Ops screen) -----------------
# Computed over the full mining cohort, not the shipped individual sample.
# Operational levers (cover, overtime, frequency, return-to-work, leave) the HR
# team owns day to day. Cost and spell assumptions are benchmark-anchored and
# documented in hr_ops["assumptions"]; they stay illustrative until live HR data.
WORK_DAYS_YR = 230.0          # scheduled work days per employee per year
COVER_PREMIUM = 300.0         # R per cover-gap day (matches the shift panel)
COVER_SHARE = {"High-intensity ops": 0.90, "Standard ops": 0.70, "Light duty": 0.30}
SPELL_LEN = 4.0               # benchmark mean absence spell length (days)
LEAVE_GAP_DAYS = 180          # no annual leave taken within this window

hr = df.copy()
hr["annual_days"] = hr["predicted_absent_days_monthly"] * 12
hr["cover_share"] = hr["cohort_load"].map(COVER_SHARE).fillna(0.5)
hr["cover_gap_90d"] = hr["predicted_absent_days_90d"] * hr["cover_share"]
hr["spells_est"] = (hr["annual_days"] / SPELL_LEN).round().clip(lower=0).astype(int)
hr.loc[(hr["annual_days"] > 0) & (hr["spells_est"] < 1), "spells_est"] = 1
hr["bradford"] = hr["spells_est"] ** 2 * hr["annual_days"]

def bf_band(b):
    if b < 100: return "Low"
    if b < 400: return "Watch"
    if b < 1000: return "Review"
    return "Formal"
hr["bf_band"] = hr["bradford"].apply(bf_band)

n_hr = len(hr)
annual_days_total = float(hr["annual_days"].sum())
cover_gap_90d = float(hr["cover_gap_90d"].sum())
backfill_cost_90d = cover_gap_90d * (RAND_PER_DAY + COVER_PREMIUM)
freq_trigger = int((hr["spells_est"] >= 4).sum())
rtw_caseload = int(hr["predicted_risk_band"].isin(["Critical", "High"]).sum())
long_leave_gap = int((hr["days_since_last_leave"] > LEAVE_GAP_DAYS).sum())
repeat_absence = int(((hr["spells_est"] >= 4) & hr["predicted_risk_band"].isin(["Critical", "High"])).sum())
bf_counts = hr["bf_band"].value_counts().reindex(["Formal", "Review", "Watch", "Low"]).fillna(0).astype(int)

hr_by_cohort = []
for label in ["High-intensity ops", "Standard ops", "Light duty"]:
    sub = hr[hr["cohort_load"] == label]
    if not len(sub):
        continue
    cg = float(sub["cover_gap_90d"].sum())
    hr_by_cohort.append({
        "key": label, "label": label, "count": int(len(sub)),
        "cover_gap_days_90d": round(cg, 0),
        "backfill_cost_rand_90d": round(cg * (RAND_PER_DAY + COVER_PREMIUM), 0),
        "overtime_mean_14d": round(float(sub["overtime_hours_14d"].mean()), 1),
        "rtw_caseload": int(sub["predicted_risk_band"].isin(["Critical", "High"]).sum()),
        "long_leave_gap": int((sub["days_since_last_leave"] > LEAVE_GAP_DAYS).sum()),
        "freq_trigger": int((sub["spells_est"] >= 4).sum()),
        "mean_bradford": round(float(sub["bradford"].mean()), 0),
    })

feed["hr_ops"] = {
    "assumptions": {
        "work_days_per_year": WORK_DAYS_YR, "day_rate_rand": RAND_PER_DAY,
        "cover_premium_rand": COVER_PREMIUM, "cover_share_by_cohort": COVER_SHARE,
        "spell_length_days": SPELL_LEN, "leave_gap_days": LEAVE_GAP_DAYS,
    },
    "headline": {
        "covered_lives": n_hr,
        "absence_rate": round(annual_days_total / (n_hr * WORK_DAYS_YR), 4),
        "cover_gap_days_90d": round(cover_gap_90d, 0),
        "backfill_cost_rand_90d": round(backfill_cost_90d, 0),
        "rtw_caseload": rtw_caseload,
        "freq_trigger_count": freq_trigger,
    },
    "cover": {
        "predicted_absent_days_90d": round(float(hr["predicted_absent_days_90d"].sum()), 0),
        "cover_gap_days_90d": round(cover_gap_90d, 0),
        "backfill_cost_rand_90d": round(backfill_cost_90d, 0),
        "overtime_mean_14d": round(float(hr["overtime_hours_14d"].mean()), 1),
        "overtime_high_share": round(float((hr["overtime_hours_14d"] > 40).mean()), 4),
        "overtime_annual_hours": round(float(hr["overtime_hours_14d"].sum() / 14 * 365), 0),
    },
    "frequency": {
        "mean_spells_per_year": round(float(hr["spells_est"].mean()), 1),
        "median_bradford": round(float(hr["bradford"].median()), 0),
        "trigger_count": freq_trigger,
        "trigger_share": round(freq_trigger / n_hr, 4),
        "bands": [
            {"band": b, "count": int(bf_counts[b]), "share": round(float(bf_counts[b] / n_hr), 4)}
            for b in ["Formal", "Review", "Watch", "Low"]
        ],
    },
    "return_to_work": {
        "rtw_caseload": rtw_caseload,
        "rtw_share": round(rtw_caseload / n_hr, 4),
        "long_leave_gap_count": long_leave_gap,
        "long_leave_gap_share": round(long_leave_gap / n_hr, 4),
        "mean_days_since_leave": round(float(hr["days_since_last_leave"].mean()), 0),
        "repeat_absence_count": repeat_absence,
    },
    "by_cohort": hr_by_cohort,
}

print("\n== HR & Ops ==")
print(f"  absence rate: {feed['hr_ops']['headline']['absence_rate']*100:.1f}%  "
      f"cover-gap 90d: {cover_gap_90d:,.0f}d  backfill: R{backfill_cost_90d/1e6:.1f}M")
print(f"  RTW caseload: {rtw_caseload}  freq-trigger: {freq_trigger}  long-leave-gap: {long_leave_gap}")
print(f"  bradford bands: " + "  ".join(f"{b}={int(bf_counts[b])}" for b in ["Formal","Review","Watch","Low"]))

# ---- write enriched feed ----------------------------------------------------
feed["cohort_dimensions"] = [{"key": d["key"], "label": d["label"], "blurb": d["blurb"]} for d in DIMENSIONS]
feed["cohorts"] = cohorts
feed["individuals"] = individuals
feed["covered_cohort"] = {
    "count": int(len(df)),
    "predicted_absent_days_90d": round(float(df["predicted_absent_days_90d"].sum()), 0),
    "high_or_critical_count": int(df["predicted_risk_band"].isin(["Critical", "High"]).sum()),
}

out_json = f"{ROOT}/data/outputs/dashboard_feed.json"
json.dump(feed, open(out_json, "w"), indent=2, default=float)
js = ("// Auto-generated by welo_pipeline.export (+cohort/individual enrichment). Do not edit by hand.\n"
      "// Source: dashboard_feed.json\n"
      "window.WELO_FEED = " + json.dumps(feed, indent=2, default=float) + ";\n")
open(f"{ROOT}/data/outputs/dashboard_feed.js", "w").write(js)
print("\nwrote", out_json, os.path.getsize(out_json), "bytes")
