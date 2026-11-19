"""
What short staffing costs: cover bought, revenue lost, and the next 90 days.

The demand view shows where absence lands on busy periods. This puts money on
it, for a tenant whose departments earn revenue by service, in four steps.

1. **History.** Shift by shift, what was scheduled, who was off, what cover was
   bought and what each service took. No client's trading data is connected
   yet, so the history is synthetic: 24 months for a group of properties,
   rostered to the sector demand pattern in the feed, with each department's
   absence rate taken from the model. The method below never sees how the
   history was made; it sees only what a client's systems would hold.

2. **Matched comparison.** A service that ran short is compared with services
   that ran fully staffed at the same property, for the same service, on the
   same kind of day, within MATCH_WINDOW_DAYS, with planned demand within
   DEMAND_TOLERANCE (WIDE_DEMAND_TOLERANCE when too few match). What those services took per unit of demand, times this
   service's demand, is what it should have taken. The gap is the estimated
   loss. The range comes from drawing a comparator at random, many times over,
   so it carries both the uncertainty in the comparison and the ordinary
   variation from one service to the next.

3. **Cost model.** Cover spend is a fact (invoices). Lost revenue is an
   estimate and is always shown as a range. Departments whose short shifts do
   not show up in a till are not priced: they get a service indicator instead,
   counted and labelled as unpriced, because putting a rand figure on a room
   turned late would be a guess dressed as a number.

4. **Forecast.** The next FORECAST_DAYS: the rostered shifts the demand pattern
   implies, absences at the model's rates, simulated many times, each run
   priced with one draw of the cost of a short shift. Value at risk is the
   cover the gaps will need plus the revenue they will lose.

Nothing here is keyed by person. Shifts are counted by property, department,
date and service; no employee appears in the history, the estimate or the feed.

Because the history is generated, the true loss is known, and the block
reports how close the method came. That check is the reason the history is
synthetic rather than a placeholder: it shows the method works before a client
supplies data, and on a client's data the check simply disappears.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

WORK_DAYS_YR = 230
SHIFTS_PER_HEAD_PER_DAY = 5.0 / 7.0 * 0.93  # five days a week, less leave

MATCH_WINDOW_DAYS = 90
DEMAND_TOLERANCE = 0.10
WIDE_DEMAND_TOLERANCE = 0.30
MIN_MATCHES = 5
DRAWS = 400
FORECAST_DAYS = 90
RANGE = (10, 90)  # percentiles reported as low and high
# How far the model's absence rate may be off, as the spread of a lognormal
# multiplier drawn once per forecast run. The rate is an estimate; a forecast
# whose range ignored that would be precise about the wrong number.
RATE_UNCERTAINTY = 0.10


# --- 1. History ---------------------------------------------------------------

def _normalised(series):
    a = np.asarray(series, dtype=float)
    return a / a.mean()


def _month_bucket(day_of_month):
    """Index into the demand block's days-of-the-month labels."""
    return np.select(
        [day_of_month <= 5, day_of_month <= 10, day_of_month <= 15, day_of_month <= 20,
         day_of_month <= 24, day_of_month <= 28],
        [0, 1, 2, 3, 4, 5], default=6,
    )


def _calendar(start, days, demand_config, department=None):
    """Expected demand and absence multipliers for each date, around 1.0."""
    dates = pd.date_range(start, periods=days, freq="D")
    month = dates.month.to_numpy() - 1
    bucket = _month_bucket(dates.day.to_numpy())
    dow = dates.dayofweek.to_numpy()
    pattern = demand_config["pattern"]
    by_dept = pattern.get("by_department", {}).get(department, {}) if department else {}
    year = _normalised(by_dept.get("year", pattern["default"]["year"]))
    mon = _normalised(by_dept.get("month", pattern["default"]["month"]))
    week = _normalised(by_dept.get("week", pattern["default"]["week"]))
    mult = demand_config["absence_multiplier"]
    return {
        "dates": dates,
        "demand": year[month] * mon[bucket] * week[dow],
        "absence": (np.asarray(mult["year"])[month] * np.asarray(mult["month"])[bucket]
                    * np.asarray(mult["week"])[dow]),
        "weekend": dow >= 5,
    }


def _rates(feed):
    """Each shown department's daily absence rate and headcount, from the model."""
    rows = (feed.get("cohorts") or {}).get("cohort_department") or []
    return {
        r["label"]: {"rate": r["absent_days_per_head_annual"] / WORK_DAYS_YR, "count": r["count"]}
        for r in rows
        if not r.get("suppressed") and r.get("absent_days_per_head_annual") is not None
    }


def _properties(config, rng):
    n = config["properties"]
    size = rng.lognormal(0.0, 0.25, n)
    size = size / size.mean()
    price = rng.lognormal(0.0, 0.20, n)  # what a unit of demand is worth there
    return size, price / price.mean()


def _simulate_shifts(start, days, config, demand_config, rates, economics, size, rng, rate_scale=1.0):
    """Scheduled, absent, covered and short shifts for every property,
    department, date and shift. Rostered to expected demand; absences drawn at
    the model's rates; cover bought at the department's cover share."""
    covered_rate = economics["day_rate_rand"] + economics["cover_premium_rand"]
    cover_share = economics["cover_share_by_department"]
    n_props = len(size)
    total_heads = sum(r["count"] for r in rates.values())
    frames = []
    for dept, shifts in config["department_shifts"].items():
        if dept not in rates:
            continue
        cal = _calendar(start, days, demand_config, dept)
        seasonal = dept in config["seasonal_departments"]
        expected = cal["demand"] if seasonal else _normalised(
            np.asarray(demand_config["pattern"].get("by_department", {}).get(dept, {}).get(
                "week", [1] * 7), dtype=float))[cal["dates"].dayofweek.to_numpy()]
        p_off = np.clip(rates[dept]["rate"] * rate_scale * cal["absence"], 0, 0.5)
        heads_share = rates[dept]["count"] / total_heads
        for p in range(n_props):
            heads = config["staff_per_property"] * size[p] * heads_share
            budget = heads * SHIFTS_PER_HEAD_PER_DAY
            for shift, share in shifts.items():
                sched = np.maximum(1, np.round(budget * share * expected)).astype(int)
                absent = rng.binomial(sched, p_off)
                covered = rng.binomial(absent, cover_share.get(dept, 0.8))
                frames.append(pd.DataFrame({
                    "property": p, "day": np.arange(days), "date": cal["dates"],
                    "weekend": cal["weekend"], "department": dept, "shift": shift,
                    "scheduled": sched, "absent": absent, "covered": covered,
                    "short": absent - covered,
                    "cover_spend": covered * covered_rate,
                }))
    out = pd.concat(frames, ignore_index=True)
    out["month"] = out["date"].dt.strftime("%Y-%m")
    return out


def generate_history(feed, config, demand_config, economics, seed=11):
    """The synthetic history: shifts, and services with their revenue.

    Returns (shifts, services). `services` carries a `true_loss` column, which
    exists only so the method can be checked; estimate() never reads it.
    """
    rng = np.random.default_rng(seed)
    rates = _rates(feed)
    size, price = _properties(config, rng)
    end = date.fromisoformat(config["history_end"])
    start = (pd.Timestamp(end) - pd.DateOffset(months=config["months"]) + pd.Timedelta(days=1)).date()
    days = (end - start).days + 1

    shifts = _simulate_shifts(start, days, config, demand_config, rates, economics, size, rng)

    cal = _calendar(start, days, demand_config)
    revenue_depts = [d for d in config["revenue_departments"] if d in rates]
    rows = []
    base = config["revenue_per_property_annual_rand"] / 365.0
    growth = (1.0 + config["price_growth_annual"]) ** (np.arange(days) / 365.0)
    for p in range(len(size)):
        day_demand = size[p] * cal["demand"] * rng.lognormal(0.0, 0.10, days)
        for service in config["services"]:
            label = service["label"]
            planned = size[p] * cal["demand"]
            demand = day_demand * rng.lognormal(0.0, 0.06, days)
            observed = demand * rng.lognormal(0.0, 0.04, days)
            potential = base * price[p] * service["revenue_share"] * demand * growth
            potential = potential * rng.lognormal(0.0, 0.08, days)
            staffing = {}
            for dept in revenue_depts:
                s = shifts[(shifts["property"] == p) & (shifts["department"] == dept)
                           & (shifts["shift"] == label)].sort_values("day")
                staffing[dept] = s
            ratio = np.ones(days)
            for s in staffing.values():
                ratio = np.minimum(ratio, 1.0 - s["short"].to_numpy() / s["scheduled"].to_numpy())
            # A short service loses more when it is busy: at a quiet lunch the
            # rest of the team absorbs a gap, at a full dinner it cannot.
            busy = np.clip(demand / size[p], 0.5, 1.6)
            loss_share = np.clip(config["loss_elasticity"] * (1.0 - ratio) * busy, 0.0, 0.5)
            true_loss = potential * loss_share
            frame = pd.DataFrame({
                "property": p, "day": np.arange(days), "date": cal["dates"],
                "weekend": cal["weekend"], "service": label,
                "planned": planned, "demand": observed,
                "revenue": potential - true_loss, "true_loss": true_loss,
                "full": ratio >= 1.0,
            })
            for dept, s in staffing.items():
                frame[f"short__{dept}"] = s["short"].to_numpy()
                frame[f"scheduled__{dept}"] = s["scheduled"].to_numpy()
            rows.append(frame)
    services = pd.concat(rows, ignore_index=True)
    services["month"] = services["date"].dt.strftime("%Y-%m")
    return shifts, services


# --- 2. Matched comparison ----------------------------------------------------

def _comparators(services):
    """For each short service, the positions of its matched fully staffed
    services in the table of fully staffed services. Returns (index of short
    services, table of fully staffed services, list of position arrays, count
    of short services with too few matches).

    Matched on planned demand, the forecast the roster was built from, not on
    measured demand. Picking comparators by measured demand favours the ones
    whose demand was over-measured, which makes them look less productive and
    understates the loss: on synthetic data, where the truth is known, that
    selection effect alone cost about 7% of it.
    """
    full_all = services[services["full"]]
    position = pd.Series(np.arange(len(full_all)), index=full_all.index)
    idx, matched, unmatched = [], [], 0
    for _, group in services.groupby(["property", "service", "weekend"], sort=False):
        full = group[group["full"]]
        f_pos = position.loc[full.index].to_numpy()
        f_day = full["day"].to_numpy()
        f_plan = full["planned"].to_numpy()
        for i, row in group[~group["full"]].iterrows():
            near = np.abs(f_day - row["day"]) <= MATCH_WINDOW_DAYS
            rel = np.abs(f_plan / row["planned"] - 1.0)
            pick = near & (rel <= DEMAND_TOLERANCE)
            if pick.sum() < MIN_MATCHES:
                pick = near & (rel <= WIDE_DEMAND_TOLERANCE)
            if pick.sum() < MIN_MATCHES:
                unmatched += 1
                continue
            idx.append(i)
            matched.append(f_pos[pick])
    return idx, full_all, matched, unmatched


def estimate(services, revenue_depts, seed=13):
    """Estimated lost revenue for each short service, as a point estimate and
    DRAWS random draws. Never reads `true_loss`.

    What a matched service earns per unit of demand is total revenue over
    total demand across its comparators. The mean of each comparator's own
    ratio would be biased upward, because measured demand is noisy and sits in
    the denominator; with loss a few percent of revenue, that small bias is a
    large share of the loss.

    The draws are a Bayesian bootstrap. Each draw gives every fully staffed
    service one random weight, shared by every short service that uses it as
    a comparator. Short services near each other lean on the same comparators,
    so their errors move together; resampling each one separately would treat
    them as independent and give a range far too narrow for a total. Each draw
    also adds one comparator's own deviation from the rate, centred, for how
    much any single service varies.
    """
    rng = np.random.default_rng(seed)
    idx, full, matched, unmatched = _comparators(services)
    short = services.loc[idx].copy()
    demand = short["demand"].to_numpy()
    revenue = short["revenue"].to_numpy()
    f_rev = full["revenue"].to_numpy()
    f_dem = full["demand"].to_numpy()
    weights_full = rng.exponential(1.0, size=(DRAWS, len(full)))
    point = np.empty(len(idx))
    draws = np.empty((len(idx), DRAWS))
    for k, pos in enumerate(matched):
        rev, dem = f_rev[pos], f_dem[pos]
        rate = rev.sum() / dem.sum()
        point[k] = rate * demand[k] - revenue[k]
        w = weights_full[:, pos]
        rates = (w @ rev) / (w @ dem)
        deviation = rev / (rate * dem) - 1.0
        deviation = deviation - deviation.mean()
        own = deviation[rng.integers(0, len(pos), size=DRAWS)]
        draws[k] = rates * (1.0 + own) * demand[k] - revenue[k]
    short["loss"] = point

    # Who the loss belongs to: split by each department's own shortfall.
    weights = np.stack([
        short[f"short__{d}"].to_numpy() / short[f"scheduled__{d}"].to_numpy() for d in revenue_depts
    ], axis=1)
    totals = weights.sum(axis=1, keepdims=True)
    weights = weights / np.where(totals > 0, totals, 1)
    return short, draws, weights, unmatched


def _range(values):
    lo, hi = np.percentile(values, RANGE)
    return {"low": round(float(lo), 0), "mid": round(float(np.median(values)), 0), "high": round(float(hi), 0)}


# --- 4. Forecast --------------------------------------------------------------

def forecast(feed, config, demand_config, economics, cost_draws, seed=17):
    """Value at risk over the next FORECAST_DAYS, by month and department.

    `cost_draws` maps each revenue department to DRAWS draws of the revenue
    lost per short shift. Each simulated run is priced with one draw.
    """
    rng = np.random.default_rng(seed)
    rates = _rates(feed)
    size, _ = _properties(config, np.random.default_rng(config.get("property_seed", 11)))
    start = date.fromisoformat(config["history_end"]) + timedelta(days=1)
    runs = []
    for b in range(DRAWS):
        scale = float(rng.lognormal(0.0, RATE_UNCERTAINTY))
        s = _simulate_shifts(start, FORECAST_DAYS, config, demand_config, rates, economics, size, rng, scale)
        g = s.groupby(["month", "department"])[["short", "cover_spend", "scheduled"]].sum().reset_index()
        g["lost_revenue"] = [
            row.short * cost_draws[row.department][b] if row.department in cost_draws else 0.0
            for row in g.itertuples()
        ]
        g["run"] = b
        runs.append(g)
    return pd.concat(runs, ignore_index=True), start


# --- The feed block -------------------------------------------------------------

def build(feed, config, demand_config, economics):
    """The staffing cost block for a feed, or None if it has no departments.

    The block carries aggregates only: by month, department and service. The
    economics it was priced with travel with it, so a reader never has to
    guess which rate made a figure.
    """
    rates = _rates(feed)
    if not rates:
        return None
    revenue_depts = [d for d in config["revenue_departments"] if d in rates]
    shifts, services = generate_history(feed, config, demand_config, economics)
    short, draws, weights, unmatched = estimate(services, revenue_depts)

    months = sorted(shifts["month"].unique())
    m_short = short["month"].to_numpy()

    history = []
    for m in months:
        sm = shifts[shifts["month"] == m]
        sel = m_short == m
        loss = draws[sel].sum(axis=0)
        history.append({
            "month": m,
            "cover_spend_rand": round(float(sm["cover_spend"].sum()), 0),
            "lost_revenue_rand": _range(loss),
            "short_shifts": int(sm["short"].sum()),
            "covered_shifts": int(sm["covered"].sum()),
            "scheduled_shifts": int(sm["scheduled"].sum()),
        })

    # Revenue lost per short shift, per revenue department: the loss
    # attributed to it, over its short shifts in short services.
    cost_draws, cost_per_short_shift = {}, {}
    for j, d in enumerate(revenue_depts):
        shifts_short = short[f"short__{d}"].to_numpy()
        attributed = (draws * weights[:, [j]]).sum(axis=0)
        per = attributed / max(1, shifts_short.sum())
        cost_draws[d] = per
        cost_per_short_shift[d] = _range(per)

    covered_rate = economics["day_rate_rand"] + economics["cover_premium_rand"]
    last12 = months[-12:]
    by_department = []
    for d in config["department_shifts"]:
        if d not in rates:
            continue
        sd = shifts[(shifts["department"] == d) & shifts["month"].isin(last12)]
        row = {
            "label": d,
            "scheduled_shifts": int(sd["scheduled"].sum()),
            "short_shifts": int(sd["short"].sum()),
            "covered_shifts": int(sd["covered"].sum()),
            "cover_spend_rand": round(float(sd["cover_spend"].sum()), 0),
            "priced": d in revenue_depts,
        }
        if d in revenue_depts:
            j = revenue_depts.index(d)
            sel = np.isin(m_short, last12)
            row["lost_revenue_rand"] = _range((draws[sel] * weights[sel][:, [j]]).sum(axis=0))
            row["lost_revenue_per_short_shift_rand"] = cost_per_short_shift[d]
        else:
            ind = config["indicators"].get(d)
            if ind:
                row["indicator"] = {
                    "label": ind["label"],
                    "value": int(round(sd["short"].sum() * ind["per_short_shift"])),
                    "unpriced": True,
                }
        by_department.append(row)

    by_service = []
    sel12 = np.isin(m_short, last12)
    s12 = services[services["month"].isin(last12)]
    for svc in config["services"]:
        lab = svc["label"]
        sel = sel12 & (short["service"].to_numpy() == lab)
        n_all = int((s12["service"] == lab).sum())
        n_short = int(sel.sum())
        by_service.append({
            "label": lab,
            "services": n_all,
            "short_services": n_short,
            "short_share": round(n_short / n_all, 4) if n_all else 0.0,
            "lost_revenue_rand": _range(draws[sel].sum(axis=0)),
        })

    last12_loss = draws[sel12].sum(axis=0)
    last12_cover = float(shifts[shifts["month"].isin(last12)]["cover_spend"].sum())

    runs, f_start = forecast(feed, config, demand_config, economics, cost_draws)
    f_end = f_start + timedelta(days=FORECAST_DAYS - 1)
    per_run = runs.groupby("run")[["short", "cover_spend", "lost_revenue"]].sum()
    f_months = []
    for m in sorted(runs["month"].unique()):
        r = runs[runs["month"] == m].groupby("run")[["short", "cover_spend", "lost_revenue"]].sum()
        days_in = sum(1 for k in range(FORECAST_DAYS) if (f_start + timedelta(days=k)).strftime("%Y-%m") == m)
        f_months.append({
            "month": m,
            "days": days_in,
            "short_shifts": _range(r["short"]),
            "cover_spend_rand": _range(r["cover_spend"]),
            "lost_revenue_rand": _range(r["lost_revenue"]),
            "value_at_risk_rand": _range(r["cover_spend"] + r["lost_revenue"]),
        })
    f_dept = []
    for d in [d for d in config["department_shifts"] if d in rates]:
        r = runs[runs["department"] == d].groupby("run")[["short", "cover_spend", "lost_revenue"]].sum()
        f_dept.append({
            "label": d,
            "priced": d in revenue_depts,
            "short_shifts": _range(r["short"]),
            "cover_spend_rand": _range(r["cover_spend"]),
            "lost_revenue_rand": _range(r["lost_revenue"]) if d in revenue_depts else None,
            "value_at_risk_rand": _range(r["cover_spend"] + r["lost_revenue"]),
        })

    true_total = float(short["true_loss"].sum())
    est_total = draws.sum(axis=0)
    month_hits = 0
    for m in months:
        sel = m_short == m
        lo, hi = np.percentile(draws[sel].sum(axis=0), RANGE)
        month_hits += int(lo <= short.loc[sel, "true_loss"].sum() <= hi)

    return {
        "measure": {
            "revenue_label": config["revenue_label"],
            "indicative": True,
            "source": "Synthetic trading and attendance history, generated for this tenant",
            "note": (
                "The history is synthetic until the tenant's attendance, trading and agency invoice data is "
                "connected. Cover spend is what cover cost. Lost revenue is an estimate, shown as a range: each "
                "short-staffed service is compared with fully staffed services like it. Departments whose short "
                "shifts do not show up in revenue are counted, not priced."
            ),
        },
        "method": {
            "match_on": ["property", "service", "weekday or weekend"],
            "window_days": MATCH_WINDOW_DAYS,
            "demand_tolerance": DEMAND_TOLERANCE,
            "min_matches": MIN_MATCHES,
            "range_percentiles": list(RANGE),
            "unmatched_short_services": unmatched,
            "matched_short_services": int(len(short)),
        },
        "assumptions": {
            "cover_rate_per_shift_rand": covered_rate,
            "day_rate_rand": economics["day_rate_rand"],
            "cover_premium_rand": economics["cover_premium_rand"],
            "cover_share_by_department": {d: economics["cover_share_by_department"][d]
                                          for d in rates if d in economics["cover_share_by_department"]},
            "properties": config["properties"],
            "revenue_departments": revenue_depts,
        },
        "window": {"start": months[0], "end": months[-1], "months": len(months)},
        "history": history,
        "last_12_months": {
            "months": [last12[0], last12[-1]],
            "cover_spend_rand": round(last12_cover, 0),
            "lost_revenue_rand": _range(last12_loss),
            "total_rand": _range(last12_loss + last12_cover),
        },
        "by_department": by_department,
        "by_service": by_service,
        "forecast": {
            "start": f_start.isoformat(),
            "end": f_end.isoformat(),
            "days": FORECAST_DAYS,
            "months": f_months,
            "total": {
                "short_shifts": _range(per_run["short"]),
                "cover_spend_rand": _range(per_run["cover_spend"]),
                "lost_revenue_rand": _range(per_run["lost_revenue"]),
                "value_at_risk_rand": _range(per_run["cover_spend"] + per_run["lost_revenue"]),
            },
            "by_department": f_dept,
            "basis": (
                "Shifts rostered to the demand pattern, absences at the model's rate for each department "
                f"(allowing the rate to be off by about {int(RATE_UNCERTAINTY * 100)}%), simulated {DRAWS} "
                "times; each run's short shifts priced with one draw of the revenue lost per short shift "
                "from the history."
            ),
        },
        "validation": {
            "synthetic_only": True,
            "note": (
                "The history is generated, so the true loss is known. This is how close the method came; on a "
                "client's data there is no true loss to compare with, and this check is not shown."
            ),
            "true_lost_revenue_rand": round(true_total, 0),
            "estimated_lost_revenue_rand": _range(est_total),
            "recovered_share": round(float(np.median(est_total)) / true_total, 3) if true_total else None,
            "months_true_within_range": month_hits,
            "months": len(months),
        },
    }
