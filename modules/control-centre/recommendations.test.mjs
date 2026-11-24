import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRecommendation,
  closeWithActual,
  decide,
  decisionBlockers,
  MIN_CLOSED_FOR_TRACK_RECORD,
  trackRecord,
  validateRecommendation,
} from "./recommendations.js";
import { portfolio } from "../absence/data/portfolio.js";
import { ROLES } from "../../lib/platform/roles.js";

/*
  Recommendations are where an agent's output turns into something a person
  acts on, so these tests are about the ways that can go wrong: a draft aimed at
  a person, a price nobody can check, an agent or its requester approving its
  own draft, and a track record that claims more than its sample supports.
*/

const context = { dimensions: portfolio.cohort_dimensions, cohorts: portfolio.cohorts };
const session = (role, email = `${role}@example.com`) => ({ email, role, permissions: ROLES[role].permissions });

const good = () => ({
  kind: "cover_booking",
  title: "Standby cover for high-intensity operations over month end",
  rationale: "The cover gap concentrates in this cohort and the overtime load leaves no slack.",
  target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
  predicted: {
    saving_rand: 180000,
    cost_rand: 60000,
    basis: "Cover-gap days at the cover-day rate, less the agency premium for the standby shifts.",
    horizon_days: 30,
  },
});

const meta = { agent: "planner", requestedBy: "prospect@example.com", dataVersion: "run-1", trace: [] };
const at = (iso) => new Date(iso);

// --- What a draft may say ----------------------------------------------------

test("a well-formed draft is valid", () => {
  assert.deepEqual(validateRecommendation(good(), context), { ok: true, errors: [] });
});

test("a draft that names a person is refused", () => {
  const d = good();
  d.rationale = "Start with EMP-10432, who is on the late close most weeks.";
  const r = validateRecommendation(d, context);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /employee key/.test(e)));
});

test("a draft carrying an identifier field is refused", () => {
  assert.equal(validateRecommendation({ ...good(), employee_id: 10432 }, context).ok, false);
});

test("disciplinary or suspicious-absence wording is refused", () => {
  for (const rationale of ["Issue a written warning after the third absence.", "Check for sick leave abuse before month end."]) {
    assert.equal(validateRecommendation({ ...good(), rationale }, context).ok, false, rationale);
  }
});

test("a protected attribute cannot be targeted", () => {
  const d = { ...good(), target: [{ dimension: "cohort_age", cohort: "Under 30" }] };
  assert.equal(validateRecommendation(d, context).ok, false);
});

test("a price without its basis is refused", () => {
  const d = good();
  d.predicted.basis = "  ";
  const r = validateRecommendation(d, context);
  assert.ok(r.errors.some((e) => /basis is required/.test(e)));
});

test("the cost of the action is required, so the net figure is honest", () => {
  const d = good();
  delete d.predicted.cost_rand;
  assert.equal(validateRecommendation(d, context).ok, false);
});

test("the horizon is a whole number of days within a year", () => {
  for (const horizon_days of [0, 2.5, 400]) {
    const d = good();
    d.predicted.horizon_days = horizon_days;
    assert.equal(validateRecommendation(d, context).ok, false, String(horizon_days));
  }
});

// --- Building ----------------------------------------------------------------

test("a built record is drafted by the agent, for the requester, with the net figure", () => {
  const rec = buildRecommendation(good(), { ...meta, trace: [{ tool: "read_cover", input: {}, ok: true, ms: 3 }] }, context);
  assert.equal(rec.status, "Drafted");
  assert.deepEqual(rec.drafted_by, { kind: "agent", agent: "planner" });
  assert.equal(rec.requested_by, "prospect@example.com");
  assert.equal(rec.predicted.net_rand, 120000);
  assert.deepEqual(rec.provenance, [{ tool: "read_cover", input: {}, ok: true }]);
});

test("building refuses an invalid draft rather than returning half a record", () => {
  assert.throws(() => buildRecommendation({ ...good(), kind: "fire_someone" }, meta, context), /kind must be one of/);
});

test("a record must say whose session asked for it", () => {
  assert.throws(() => buildRecommendation(good(), { ...meta, requestedBy: undefined }, context), /whose session/);
});

// --- Deciding ----------------------------------------------------------------

const drafted = () => buildRecommendation(good(), { ...meta, now: at("2026-01-01T08:00:00Z") }, context);

test("an approver may approve a draft someone else asked for", () => {
  const rec = decide(drafted(), { decision: "Approved", session: session("approver"), hasApprovePermission: true });
  assert.equal(rec.status, "Approved");
  assert.equal(rec.decision.by, "approver@example.com");
});

test("the person who asked for the draft cannot approve it, even holding the permission", () => {
  const requester = session("approver", "prospect@example.com");
  assert.ok(decisionBlockers(drafted(), requester, { hasApprovePermission: true }).some((b) => /asked for/.test(b)));
  assert.throws(() => decide(drafted(), { decision: "Approved", session: requester, hasApprovePermission: true }));
});

test("a role without approval rights cannot decide", () => {
  assert.throws(
    () => decide(drafted(), { decision: "Approved", session: session("analyst"), hasApprovePermission: false }),
    /may not approve/,
  );
});

test("a rejection needs a reason", () => {
  assert.throws(() => decide(drafted(), { decision: "Rejected", session: session("approver"), hasApprovePermission: true }), /note/);
  const rec = decide(drafted(), { decision: "Rejected", note: "Agency rates are higher in December.", session: session("approver"), hasApprovePermission: true });
  assert.equal(rec.status, "Rejected");
});

test("a decided recommendation cannot be decided again", () => {
  const once = decide(drafted(), { decision: "Approved", session: session("approver"), hasApprovePermission: true });
  assert.throws(() => decide(once, { decision: "Rejected", note: "x", session: session("approver"), hasApprovePermission: true }), /already approved/);
});

// --- Closing and the track record --------------------------------------------

const approved = () => decide(drafted(), { decision: "Approved", session: session("approver"), hasApprovePermission: true });

test("an outcome cannot be recorded before the horizon has passed", () => {
  assert.throws(() => closeWithActual(approved(), { saving_rand: 1, basis: "x", now: at("2026-01-15T00:00:00Z") }), /horizon runs to/);
});

test("a rejected recommendation never ran, so it cannot be closed", () => {
  const rejected = decide(drafted(), { decision: "Rejected", note: "No.", session: session("approver"), hasApprovePermission: true });
  assert.throws(() => closeWithActual(rejected, { saving_rand: 1, basis: "x", now: at("2026-03-01T00:00:00Z") }));
});

test("a loss is recorded as a negative saving, not refused", () => {
  const rec = closeWithActual(approved(), { saving_rand: -20000, basis: "Agency no-shows.", now: at("2026-03-01T00:00:00Z") });
  assert.equal(rec.status, "Closed");
  assert.equal(rec.actual.saving_rand, -20000);
});

const closedWith = (actual, predicted = 100000) => {
  const d = good();
  d.predicted.saving_rand = predicted;
  const rec = decide(buildRecommendation(d, { ...meta, now: at("2026-01-01T08:00:00Z") }, context), {
    decision: "Approved",
    session: session("approver"),
    hasApprovePermission: true,
  });
  return closeWithActual(rec, { saving_rand: actual, basis: "Measured.", now: at("2026-03-01T00:00:00Z") });
};

test("below the minimum, the track record says it cannot judge yet", () => {
  const t = trackRecord([closedWith(90000), closedWith(50000)]);
  assert.equal(t.enough, false);
  assert.match(t.summary, new RegExp(`At least ${MIN_CLOSED_FOR_TRACK_RECORD}`));
});

test("the track record uses the median, so one large case does not carry it", () => {
  const recs = [closedWith(50000), closedWith(60000), closedWith(70000), closedWith(80000), closedWith(900000)];
  const t = trackRecord(recs);
  assert.equal(t.enough, true);
  assert.equal(t.median_actual_to_predicted, 0.7);
  assert.match(t.summary, /70% of predicted/);
});

test("the track record summary carries no currency figure the toggle could not reach", () => {
  const t = trackRecord([closedWith(50000), closedWith(60000), closedWith(70000), closedWith(80000), closedWith(90000)]);
  assert.ok(!/(R|\$)\s?\d/.test(t.summary));
});

test("drafts and rejections count toward the decision tally, not the outcome", () => {
  const rejected = decide(drafted(), { decision: "Rejected", note: "No.", session: session("approver"), hasApprovePermission: true });
  const t = trackRecord([drafted(), rejected, closedWith(1)]);
  assert.equal(t.closed, 1);
  assert.equal(t.rejected, 1);
  assert.equal(t.approved, 1);
});


test("a proposal's horizon is the band its days fall in, unless it says one", async () => {
  const { horizonFor, HORIZONS } = await import("./recommendations.js");
  assert.equal(horizonFor(7), "week");
  assert.equal(horizonFor(30), "month");
  assert.equal(horizonFor(120), "season");
  assert.equal(horizonFor(0), null);
  // The bands meet without a gap or an overlap.
  for (let i = 1; i < HORIZONS.length; i++) assert.equal(HORIZONS[i].min, HORIZONS[i - 1].max + 1);
});
