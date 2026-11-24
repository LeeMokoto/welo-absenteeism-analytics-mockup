/*
  Reviewing a finished proposal: what it was predicted to save, and what the
  data says it delivered.

  The Reviewer is the other half of the Planner. The Planner prices an action
  before it runs; the Reviewer measures it after, and drafts the outcome for a
  person to check and record through the same close route a person would use.
  Three rules keep it a measurement rather than a second opinion:

  1. **It sees the prediction, not the reasoning.** blindView() hands it a
     proposal's target, horizon and predicted saving and cost, and leaves out
     the rationale, the basis and what the Planner read. A reviewer that reads
     the argument tends to grade the argument.
  2. **It never reviews its own work.** A proposal drafted by the Reviewer is
     refused. (It drafts outcomes, not proposals, so this should never arise;
     the rule is here so that stays true if that changes.)
  3. **The method is fixed code.** The same comparison the control centre
     uses for interventions (outcomes.js): the targeted cohort's change in
     absent days per head across the proposal's start, against the change in
     the comparator cohorts frozen when it was approved. The difference is priced at the
     tenant's day rate over the cohort's headcount and the proposal's horizon.
     The range runs across comparators taken one at a time, so a single odd
     comparator shows up as width rather than hiding in an average.

  What it is not: a causal claim. The difference is what is left after
  removing movement common to cohorts nobody acted on. The draft says so, and
  so does the screen.

  Pure, so the tools, the screen and the tests apply the same rules.
*/

import { RECOMMENDATION_STATUSES, closeWithActual, validateRecommendation } from "./recommendations.js";
import { measureOutcome } from "./outcomes.js";
import { carriesIndividual } from "./store.js";

export const REVIEWER = "reviewer";
const MEASURE = "absent_days_per_head_annual";
const DAY_MS = 86400000;

export function dueDate(rec) {
  return new Date(new Date(rec.created).getTime() + rec.predicted.horizon_days * DAY_MS);
}

/* Approved, its horizon over, and not yet closed. */
export function isFinished(rec, now = new Date()) {
  return rec?.status === "Approved" && !rec.actual && dueDate(rec) <= now;
}

/* Why the Reviewer may not review this proposal. Empty means it may. */
export function reviewBlockers(rec, now = new Date()) {
  const out = [];
  if (!rec) return ["no proposal"];
  if (rec.drafted_by?.agent === REVIEWER) out.push("the Reviewer never reviews a proposal it drafted");
  if (rec.status !== "Approved") out.push(`it is ${String(rec.status || "unknown").toLowerCase()}, and only an approved proposal ran`);
  if (rec.actual) out.push("its outcome is already recorded");
  if (rec.status === "Approved" && dueDate(rec) > now) {
    out.push(`its horizon runs to ${dueDate(rec).toISOString().slice(0, 10)}`);
  }
  if (rec.status === "Approved" && !(Array.isArray(rec.comparators) && rec.comparators.length)) {
    out.push(
      "no comparator cohorts were frozen when it was approved, and choosing them now would mean choosing them knowing the answer",
    );
  }
  return out;
}

/*
  What the Reviewer is shown of a proposal: the prediction, without the
  reasoning behind it.
*/
export function blindView(rec) {
  return {
    id: rec.id,
    kind: rec.kind,
    horizon: rec.horizon || null,
    title: rec.title,
    target: rec.target,
    created: rec.created,
    due: dueDate(rec).toISOString().slice(0, 10),
    approved_on: rec.decision?.at ? String(rec.decision.at).slice(0, 10) : null,
    predicted: {
      saving_rand: rec.predicted.saving_rand,
      cost_rand: rec.predicted.cost_rand,
      horizon_days: rec.predicted.horizon_days,
    },
  };
}

export function finishedProposals(recs, now = new Date()) {
  return (recs || []).filter((r) => isFinished(r, now) && reviewBlockers(r, now).length === 0).map(blindView);
}

function headcount(target, series, cohorts) {
  const fromSeries = series?.series?.[target.dimension]?.cohorts?.[target.cohort]?.count;
  if (Number.isFinite(fromSeries)) return fromSeries;
  const row = (cohorts?.[target.dimension] || []).find((c) => c.key === target.cohort);
  return Number.isFinite(row?.count) ? row.count : null;
}

/*
  Measure a finished proposal. Returns { ok: false, reasons } when it cannot
  be measured, so a caller cannot read a partial result as a finding.
*/
export function measureProposal(rec, { series, cohorts, dayRate, now = new Date() } = {}) {
  const reasons = reviewBlockers(rec, now);
  if (reasons.length) return { ok: false, reasons };
  if ((rec.target || []).length !== 1) {
    return { ok: false, reasons: ["it targets more than one cohort, and the comparison measures one"] };
  }
  if (!Number.isFinite(dayRate) || dayRate <= 0) return { ok: false, reasons: ["no day rate to price the difference"] };

  const target = rec.target[0];
  const outcome = measureOutcome({ target: [target], comparators: rec.comparators, created: rec.created }, series, {
    measure: MEASURE,
  });
  if (!outcome || outcome.difference === null) {
    return {
      ok: false,
      reasons: ["the cohort series does not cover enough months either side of the start, or no comparator is reportable"],
    };
  }

  const heads = headcount(target, series, cohorts);
  if (!heads) return { ok: false, reasons: ["the targeted cohort's headcount is not reportable"] };

  // Days per head a year, saved, over the horizon, at the day rate. A
  // difference below zero means the cohort fell against its comparators,
  // which is a saving.
  const years = rec.predicted.horizon_days / 365;
  const price = (difference) => Math.round(-difference * heads * years * dayRate);
  const usable = outcome.comparators.filter((c) => !c.withheld);
  const each = usable.map((c) => price(outcome.targeted.change - c.change));
  const saving = price(outcome.difference);
  const range = each.length
    ? { low: Math.min(...each), mid: saving, high: Math.max(...each) }
    : { low: saving, mid: saving, high: saving };

  const predicted = rec.predicted.saving_rand;
  return {
    ok: true,
    proposal: blindView(rec),
    method:
      "The targeted cohort's change in absent days per head a year, before and after the proposal started, against the same change in the other cohorts of its dimension. Priced at the day rate over the cohort's headcount and the proposal's horizon. An observed difference, not a proven cause.",
    measure: MEASURE,
    cohort: { dimension: target.dimension, cohort: target.cohort, headcount: heads },
    targeted: outcome.targeted,
    comparators: outcome.comparators,
    comparator_change: outcome.comparator_change,
    difference_days_per_head_annual: outcome.difference,
    day_rate_rand: dayRate,
    measured_saving_rand: range,
    predicted_saving_rand: predicted,
    delivered_share: predicted > 0 ? Math.round((saving / predicted) * 100) / 100 : null,
    // Worked out here so the agent quotes it rather than doing arithmetic in
    // prose, which is where a wrong number would sound most confident.
    shortfall_rand: Math.max(0, predicted - saving),
  };
}

/*
  The outcome the Reviewer drafts for a person to check. Validated with the
  same rule the close route applies (closeWithActual), so a draft the route
  would refuse is refused here first, but nothing is recorded.
*/
export function draftOutcome(rec, { saving_rand, basis, measured = null, requestedBy, now = new Date() } = {}) {
  const reasons = reviewBlockers(rec, now);
  if (reasons.length) throw new Error(`Cannot draft an outcome: ${reasons.join("; ")}.`);
  if (carriesIndividual({ basis })) throw new Error("An outcome cannot carry a person's identifier.");
  // Throws with the close route's own message if the figure or basis is unusable.
  closeWithActual(rec, { saving_rand, basis, now });
  return {
    id: rec.id,
    saving_rand: Math.round(saving_rand),
    basis: String(basis).trim(),
    range: measured?.measured_saving_rand || null,
    predicted_saving_rand: rec.predicted.saving_rand,
    drafted_by: { kind: "agent", agent: REVIEWER },
    requested_by: requestedBy || null,
    drafted: now.toISOString(),
  };
}

/*
  The proposals a Reviewer run may see: the tenant's examples, overlaid with
  the records a browser sent. Those crossed the network, so each is checked
  (shape, cohort-level target, no person's identifier) and anything that
  fails is dropped rather than trusted. Measuring a record is harmless; what
  matters is that an outcome is only ever drafted, and the close route checks
  it again when a person records it.
*/
export const MAX_SENT_PROPOSALS = 200;

export function acceptProposals(examples, sent, context) {
  const byId = new Map((examples || []).map((r) => [r.id, r]));
  for (const r of (Array.isArray(sent) ? sent : []).slice(0, MAX_SENT_PROPOSALS)) {
    if (!r || typeof r !== "object" || typeof r.id !== "string") continue;
    if (carriesIndividual(r)) continue;
    if (!RECOMMENDATION_STATUSES.includes(r.status)) continue;
    if (Number.isNaN(new Date(r.created).getTime())) continue;
    if (!validateRecommendation(r, context).ok) continue;
    byId.set(r.id, r);
  }
  return [...byId.values()];
}
