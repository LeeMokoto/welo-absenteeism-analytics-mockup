/*
  Reading the staffing cost block: what short staffing has cost, and what the
  next 90 days put at risk.

  The block is built in model/staffing_cost.py, priced with the economics the
  feed carries (the single source for the day rate, the cover premium and the
  cover shares; nothing is re-priced here). Only a tenant whose departments
  earn revenue by service carries one.

  Three kinds of figure, kept apart everywhere they are shown:
  - Cover spend: what cover cost. A fact, from invoices.
  - Lost revenue: an estimate, always a range (low, mid, high).
  - Service indicators: counted for departments whose short shifts do not show
    up in revenue, and never priced.

  These helpers are pure so the screen, the agent tool and the tests read the
  block the same way. No sector's words are written here: department, service
  and indicator names all come from the data.
*/

export function hasStaffingCost(portfolio) {
  const s = portfolio?.staffing_cost;
  return Boolean(s && Array.isArray(s.history) && s.history.length && s.forecast && s.last_12_months);
}

export function isRange(r) {
  return Boolean(r && Number.isFinite(r.low) && Number.isFinite(r.mid) && Number.isFinite(r.high));
}

/*
  "2026-03" as "Mar 2026", or "Mar" when `short`. Parsed by hand, not through
  Date, so a time zone can never move a month.
*/
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(ym, { short = false } = {}) {
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return String(ym);
  return short ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}

/*
  One timeline: the history months, then the forecast months. History rows
  carry cover spend as a single figure; forecast rows carry it as a range,
  because it has not happened yet. `kind` says which, so a chart can draw the
  two differently and nobody mistakes a forecast for a record.
*/
export function timeline(block) {
  if (!block) return [];
  const past = (block.history || []).map((m) => ({
    month: m.month,
    kind: "history",
    cover_spend_rand: { low: m.cover_spend_rand, mid: m.cover_spend_rand, high: m.cover_spend_rand },
    lost_revenue_rand: m.lost_revenue_rand,
    short_shifts: m.short_shifts,
  }));
  const ahead = (block.forecast?.months || []).map((m) => ({
    month: m.month,
    kind: "forecast",
    days: m.days,
    cover_spend_rand: m.cover_spend_rand,
    lost_revenue_rand: m.lost_revenue_rand,
    short_shifts: m.short_shifts?.mid,
  }));
  return [...past, ...ahead].map((r) => ({
    ...r,
    total_rand: {
      low: r.cover_spend_rand.low + r.lost_revenue_rand.low,
      mid: r.cover_spend_rand.mid + r.lost_revenue_rand.mid,
      high: r.cover_spend_rand.high + r.lost_revenue_rand.high,
    },
  }));
}

/*
  The headline figures, for a tile row and for the agent. Every estimate stays
  a range; cover spend over the last year is a single figure because it is
  what was paid.
*/
export function summary(block) {
  if (!block) return null;
  const l12 = block.last_12_months;
  const f = block.forecast;
  const priced = (block.by_department || []).filter((d) => d.priced);
  const perShift = priced
    .map((d) => d.lost_revenue_per_short_shift_rand)
    .filter(isRange);
  const coverRate = block.assumptions?.cover_rate_per_shift_rand;
  return {
    last_12_months: {
      from: l12.months?.[0],
      to: l12.months?.[1],
      cover_spend_rand: l12.cover_spend_rand,
      lost_revenue_rand: l12.lost_revenue_rand,
      total_rand: l12.total_rand,
    },
    next_90_days: {
      from: f.start,
      to: f.end,
      value_at_risk_rand: f.total.value_at_risk_rand,
      cover_spend_rand: f.total.cover_spend_rand,
      lost_revenue_rand: f.total.lost_revenue_rand,
      short_shifts: f.total.short_shifts,
    },
    // What an uncovered shift lost, beside what cover costs: the comparison
    // that says whether buying cover paid. Lowest and highest across the
    // priced departments, as ranges stay ranges.
    cover_rate_per_shift_rand: coverRate,
    lost_revenue_per_short_shift_rand: perShift.length
      ? {
          low: Math.min(...perShift.map((r) => r.low)),
          mid: perShift.reduce((a, r) => a + r.mid, 0) / perShift.length,
          high: Math.max(...perShift.map((r) => r.high)),
        }
      : null,
    cover_pays: perShift.length && Number.isFinite(coverRate)
      ? perShift.every((r) => r.low > coverRate)
      : null,
  };
}

/*
  One department, by name, for the last 12 months and the next 90 days. An
  unknown name returns null rather than falling back to the whole group.
*/
export function departmentView(block, label) {
  if (!block || !label) return null;
  const past = (block.by_department || []).find((d) => d.label === label);
  if (!past) return null;
  const ahead = (block.forecast?.by_department || []).find((d) => d.label === label) || null;
  return { ...past, next_90_days: ahead };
}

/* "2027-01-29" as "29 Jan 2027", by hand for the same reason. */
export function dateLabel(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return String(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function departmentNames(block) {
  return (block?.by_department || []).map((d) => d.label);
}
