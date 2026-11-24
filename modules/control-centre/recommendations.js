/*
  Recommendations: what an agent proposes, and what became of it.

  This is the record that closes the loop. An agent drafts a recommendation
  with a price on it, a person approves or rejects it, the action runs, and
  when the period closes the predicted saving is set against what actually
  happened. Over time that is the agents' track record, and it is the evidence
  a manager needs before letting them do more on their own.

  It sits beside interventions and playbooks rather than replacing them. An
  intervention is a programme aimed at a cohort over months. A recommendation
  is one priced action: book standby for a weekend, change a roster pattern,
  time a screening campaign. An approved recommendation can become an
  intervention when it is big enough to need a playbook.

  The rules, each enforced by a function here and held by a test:

  1. **Cohort level.** A target uses the same validation as an intervention, so
     a recommendation cannot reach a group an intervention could not. Text that
     names a person or reads as an attendance or disciplinary step is refused,
     with the same screens playbook steps use.

  2. **A price and its basis travel together.** A predicted saving without the
     reasoning behind it is a number nobody can check later, so a draft without
     a basis is refused.

  3. **An agent drafts and never decides.** The drafter is recorded as the
     agent and the person whose session asked for it. Neither may approve: the
     agent because it is not a person, the requester because approval is
     separate from creation. Approval needs CONTROL_APPROVE.

  4. **The track record is honest about its size.** It reports how many
     recommendations have closed and what they predicted against what they
     delivered. Below a minimum count it says there is too little to judge
     rather than publishing a hit rate from three cases.

  Pure and synchronous. Persistence is the store's job, and this tenant's store
  is mocked; see store.js.
*/

import { validateTarget } from "./targeting.js";
import { individualReferenceIn, refusedLanguageIn } from "./playbooks.js";
import { carriesIndividual } from "./store.js";

export const RECOMMENDATION_STATUSES = ["Drafted", "Approved", "Rejected", "Closed"];

/*
  What an agent may propose. Each kind is an action a manager already takes;
  the agent prices it and drafts it, it does not invent new kinds of action.
*/
export const KINDS = [
  { key: "cover_booking", label: "Book standby or agency cover" },
  { key: "roster_change", label: "Change a roster pattern" },
  { key: "health_campaign", label: "Time a health or screening campaign" },
  { key: "hiring_plan", label: "Plan seasonal or casual hiring" },
  { key: "review", label: "Review a pattern before acting" },
];
export const KIND_KEYS = KINDS.map((k) => k.key);

// Below this, the track record says it cannot judge yet.
export const MIN_CLOSED_FOR_TRACK_RECORD = 5;

// A horizon long enough to measure and short enough to remember why.
export const MAX_HORIZON_DAYS = 365;

/*
  The Planner's horizons. One agent plans at every timescale, and the horizon
  is an input to what it reads and drafts rather than a separate agent: next
  week before the roster goes out, the month ahead, or the season. Each covers
  a band of days, so a draft that says "next week" over 90 days is refused.
*/
export const HORIZONS = [
  { key: "week", label: "Next week", min: 1, max: 14 },
  { key: "month", label: "Month ahead", min: 15, max: 62 },
  { key: "season", label: "Season", min: 63, max: MAX_HORIZON_DAYS },
];
export const HORIZON_KEYS = HORIZONS.map((h) => h.key);

/* The horizon a number of days falls in. */
export function horizonFor(days) {
  const h = HORIZONS.find((x) => days >= x.min && days <= x.max);
  return h ? h.key : null;
}

export function horizonLabel(key) {
  return HORIZONS.find((h) => h.key === key)?.label || null;
}

function textProblems(text, where) {
  const errors = [];
  for (const hit of individualReferenceIn(text)) {
    errors.push(`${where} refers to ${hit}. A recommendation addresses a cohort, never a person.`);
  }
  for (const { term, reason } of refusedLanguageIn(text)) {
    errors.push(`${where} reads as ${reason} ("${term}"), which is outside what this platform proposes.`);
  }
  return errors;
}

/*
  Validate a draft. `context` carries the cohort dimensions and cohorts the
  target is checked against, the same shape targeting.js takes.
*/
export function validateRecommendation(draft, context = {}) {
  const errors = [];
  const d = draft || {};

  if (carriesIndividual(d)) {
    errors.push("A recommendation cannot carry a person's identifier.");
  }
  if (!KIND_KEYS.includes(d.kind)) {
    errors.push(`kind must be one of: ${KIND_KEYS.join(", ")}.`);
  }
  if (!String(d.title || "").trim()) errors.push("A recommendation needs a title.");
  if (!String(d.rationale || "").trim()) errors.push("A recommendation needs a rationale.");

  const target = validateTarget(d.target, context);
  errors.push(...target.errors);

  const p = d.predicted || {};
  if (typeof p.saving_rand !== "number" || !Number.isFinite(p.saving_rand) || p.saving_rand < 0) {
    errors.push("predicted.saving_rand must be a figure in Rand, zero or more.");
  }
  if (typeof p.cost_rand !== "number" || !Number.isFinite(p.cost_rand) || p.cost_rand < 0) {
    errors.push("predicted.cost_rand must be a figure in Rand, zero or more. Say what the action costs.");
  }
  if (!String(p.basis || "").trim()) {
    errors.push("predicted.basis is required: say how the saving was worked out, so it can be checked later.");
  }
  if (!Number.isInteger(p.horizon_days) || p.horizon_days < 1 || p.horizon_days > MAX_HORIZON_DAYS) {
    errors.push(`predicted.horizon_days must be a whole number of days from 1 to ${MAX_HORIZON_DAYS}.`);
  } else if (d.horizon !== undefined && d.horizon !== null) {
    const h = HORIZONS.find((x) => x.key === d.horizon);
    if (!h) {
      errors.push(`horizon must be one of: ${HORIZON_KEYS.join(", ")}.`);
    } else if (p.horizon_days < h.min || p.horizon_days > h.max) {
      errors.push(`A ${h.label.toLowerCase()} proposal runs ${h.min} to ${h.max} days; this one says ${p.horizon_days}.`);
    }
  }

  errors.push(...textProblems(d.title, "The title"));
  errors.push(...textProblems(d.rationale, "The rationale"));
  errors.push(...textProblems(p.basis, "The basis"));

  return { ok: errors.length === 0, errors };
}

/*
  Build the record an agent's draft becomes. Throws on an invalid draft rather
  than returning a half-record: the drafting tool turns the errors into a
  refusal the model can read and correct.
*/
export function buildRecommendation(draft, { agent, requestedBy, dataVersion, trace, now = new Date() }, context) {
  const check = validateRecommendation(draft, context);
  if (!check.ok) {
    const err = new Error(check.errors.join(" "));
    err.errors = check.errors;
    throw err;
  }
  if (!agent) throw new Error("A recommendation records which agent drafted it.");
  if (!requestedBy) throw new Error("A recommendation records whose session asked for it.");

  const p = draft.predicted;
  return {
    id: `rec-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: draft.kind,
    title: draft.title.trim(),
    rationale: draft.rationale.trim(),
    // The horizon the Planner was asked about, or the one its days fall in.
    horizon: draft.horizon || horizonFor(draft.predicted.horizon_days),
    target: draft.target.map(({ dimension, cohort }) => ({ dimension, cohort })),
    predicted: {
      saving_rand: Math.round(p.saving_rand),
      cost_rand: Math.round(p.cost_rand),
      net_rand: Math.round(p.saving_rand - p.cost_rand),
      basis: p.basis.trim(),
      horizon_days: p.horizon_days,
    },
    status: "Drafted",
    drafted_by: { kind: "agent", agent },
    requested_by: requestedBy,
    created: now.toISOString(),
    data_version: dataVersion || null,
    // What the agent read before drafting. Tool names and inputs only: the
    // outputs are reproducible from the data version and are not copied here.
    provenance: (trace || []).map(({ tool, input, ok }) => ({ tool, input, ok })),
    decision: null,
    actual: null,
  };
}

/*
  Why a session may not approve or reject this recommendation. Empty means it
  may.
*/
export function decisionBlockers(rec, session, { hasApprovePermission } = {}) {
  const blockers = [];
  if (!session) return ["no session"];
  if (!hasApprovePermission) blockers.push("this role may not approve recommendations");
  if (rec?.requested_by && rec.requested_by === session.email) {
    blockers.push("the person who asked for a recommendation cannot approve it");
  }
  if (rec?.status !== "Drafted") {
    blockers.push(`this recommendation is already ${String(rec?.status || "unknown").toLowerCase()}`);
  }
  return blockers;
}

export function decide(rec, { decision, note, session, hasApprovePermission, now = new Date() }) {
  if (decision !== "Approved" && decision !== "Rejected") {
    throw new Error("decision must be Approved or Rejected.");
  }
  const blockers = decisionBlockers(rec, session, { hasApprovePermission });
  if (blockers.length) throw new Error(`Cannot decide: ${blockers.join("; ")}.`);
  if (decision === "Rejected" && !String(note || "").trim()) {
    // A rejection with no reason teaches the agents nothing, and the reason is
    // what a reviewer reads when the same draft comes back next month.
    throw new Error("A rejection needs a note saying why.");
  }
  return {
    ...rec,
    status: decision,
    decision: { decision, by: session.email, role: session.role, note: String(note || "").trim() || null, at: now.toISOString() },
  };
}

/*
  Record what actually happened once the horizon has passed. Only an approved
  recommendation can be closed: a rejected one never ran, so it has no outcome.
*/
export function closeWithActual(rec, { saving_rand, basis, now = new Date() }) {
  if (rec?.status !== "Approved") throw new Error("Only an approved recommendation can be closed with an outcome.");
  if (typeof saving_rand !== "number" || !Number.isFinite(saving_rand)) {
    throw new Error("The actual saving must be a figure in Rand. A loss is a negative figure.");
  }
  if (!String(basis || "").trim()) throw new Error("Say how the actual saving was measured.");
  const created = new Date(rec.created);
  const due = new Date(created.getTime() + rec.predicted.horizon_days * 86400000);
  if (now < due) {
    throw new Error(`The horizon runs to ${due.toISOString().slice(0, 10)}. Close it after that, not before.`);
  }
  return {
    ...rec,
    status: "Closed",
    actual: { saving_rand: Math.round(saving_rand), basis: basis.trim(), at: now.toISOString() },
  };
}

/*
  The agents' track record over closed recommendations.

  Totals and a median ratio, not a single success percentage. The median
  because one large booking would otherwise dominate a mean. Below the minimum
  count, `enough` is false and `summary` says so in words; the figures are still
  returned so a reviewer can see them, but the interface leads with the
  sentence.
*/
export function trackRecord(recs) {
  const closed = (recs || []).filter((r) => r.status === "Closed" && r.actual);
  const n = closed.length;
  const predicted = closed.reduce((s, r) => s + r.predicted.saving_rand, 0);
  const actual = closed.reduce((s, r) => s + r.actual.saving_rand, 0);
  const ratios = closed
    .filter((r) => r.predicted.saving_rand > 0)
    .map((r) => r.actual.saving_rand / r.predicted.saving_rand)
    .sort((a, b) => a - b);
  const median = ratios.length
    ? ratios.length % 2
      ? ratios[(ratios.length - 1) / 2]
      : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2
    : null;
  const enough = n >= MIN_CLOSED_FOR_TRACK_RECORD;
  const decided = (recs || []).filter((r) => r.decision);
  return {
    closed: n,
    predicted_saving_rand: predicted,
    actual_saving_rand: actual,
    median_actual_to_predicted: median == null ? null : Math.round(median * 100) / 100,
    approved: decided.filter((r) => r.decision.decision === "Approved").length,
    rejected: decided.filter((r) => r.decision.decision === "Rejected").length,
    enough,
    summary: !enough
      ? `${n} closed so far. At least ${MIN_CLOSED_FOR_TRACK_RECORD} are needed before the track record means anything.`
      : median == null
        ? `${n} closed recommendations, none of which predicted a saving, so there is nothing to compare.`
        : `${n} closed recommendations. Delivered savings ran at ${Math.round(median * 100)}% of predicted, taking the median case.`,
  };
}
