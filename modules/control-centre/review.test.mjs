import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  REVIEWER,
  acceptProposals,
  blindView,
  draftOutcome,
  finishedProposals,
  measureProposal,
  reviewBlockers,
} from "./review.js";
import { exampleRecommendations } from "./recommendationStore.js";
import { decide } from "./recommendations.js";

/*
  The Reviewer measures; it does not agree. These hold the rules that make
  that true: it sees the prediction and not the reasoning, it measures against
  comparators frozen before the answer was known, it never reviews its own
  work, and it only ever drafts an outcome.
*/

const out = (f) => fileURLToPath(new URL(`../../model/data/outputs/${f}`, import.meta.url));
const load = (f) => (existsSync(out(f)) ? JSON.parse(readFileSync(out(f), "utf8")) : null);
const TENANTS = {
  base: { feed: load("dashboard_feed.json"), series: load("cohort_series.json") },
  hospitality: { feed: load("dashboard_feed.hospitality.json"), series: load("cohort_series.hospitality.json") },
};
const skip = !(TENANTS.base.feed && TENANTS.hospitality.feed && TENANTS.base.series && TENANTS.hospitality.series) && "feeds not built";
const NOW = new Date("2026-11-24T09:00:00Z");

function setup(tenant) {
  const { feed, series } = TENANTS[tenant];
  const context = { tenant, dimensions: feed.cohort_dimensions, cohorts: feed.cohorts };
  const recs = exampleRecommendations(context);
  const measureCtx = { series, cohorts: feed.cohorts, dayRate: feed.hr_ops.assumptions.day_rate_rand, now: NOW };
  return { feed, series, context, recs, measureCtx };
}

test("each tenant ships a finished proposal for the Reviewer, with frozen comparators", { skip }, () => {
  for (const tenant of ["base", "hospitality"]) {
    const { recs } = setup(tenant);
    const finished = finishedProposals(recs, NOW);
    assert.ok(finished.length >= 1, tenant);
    for (const v of finished) {
      const rec = recs.find((r) => r.id === v.id);
      assert.ok(rec.comparators?.length > 0, `${tenant} ${v.id} has no frozen comparators`);
    }
  }
});

test("the Reviewer sees the prediction and not the reasoning", { skip }, () => {
  const { recs } = setup("hospitality");
  const rec = recs.find((r) => r.id === "rec-example-kitchen-roster");
  const view = blindView(rec);
  const text = JSON.stringify(view);
  assert.equal(view.predicted.saving_rand, rec.predicted.saving_rand);
  for (const hidden of ["rationale", "basis", "provenance", "requested_by", "decision"]) {
    assert.ok(!(hidden in view) && !(hidden in view.predicted), `${hidden} reached the Reviewer`);
  }
  assert.ok(!text.includes(rec.rationale));
  assert.ok(!text.includes(rec.predicted.basis));
});

test("a shortfall is measured as a shortfall", { skip }, () => {
  const { recs, measureCtx } = setup("hospitality");
  const m = measureProposal(recs.find((r) => r.id === "rec-example-kitchen-roster"), measureCtx);
  assert.equal(m.ok, true, JSON.stringify(m.reasons));
  assert.ok(m.difference_days_per_head_annual < 0, "the Kitchen should fall against its comparators");
  const r = m.measured_saving_rand;
  assert.ok(r.low <= r.mid && r.mid <= r.high);
  assert.ok(m.delivered_share < 1, "the example was predicted to save more than it delivered");
  assert.equal(m.day_rate_rand, 650);
});

test("the base tenant's finished proposal measures too", { skip }, () => {
  const { recs, measureCtx } = setup("base");
  const m = measureProposal(recs.find((r) => r.id === "rec-example-hours"), measureCtx);
  assert.equal(m.ok, true, JSON.stringify(m.reasons));
  assert.ok(m.measured_saving_rand.mid > 0);
});

test("comparators are frozen at approval, and a proposal without them is not measured", { skip }, () => {
  const { recs, measureCtx } = setup("hospitality");
  const rec = recs.find((r) => r.id === "rec-example-kitchen-roster");
  const { comparators, ...unfrozen } = rec;
  const m = measureProposal(unfrozen, measureCtx);
  assert.equal(m.ok, false);
  assert.match(m.reasons.join(" "), /knowing the answer/);
});

test("approval freezes the comparators it is given; rejection freezes none", () => {
  const rec = { status: "Drafted", requested_by: "a@example.com", target: [{ dimension: "d", cohort: "x" }] };
  const session = { email: "b@example.com", role: "approver" };
  const approved = decide(rec, { decision: "Approved", note: "ok", session, hasApprovePermission: true, comparators: ["y", "z"] });
  assert.deepEqual(approved.comparators, ["y", "z"]);
  const rejected = decide(rec, { decision: "Rejected", note: "no", session, hasApprovePermission: true, comparators: ["y"] });
  assert.equal(rejected.comparators, undefined);
});

test("the Reviewer never reviews its own work", () => {
  const rec = {
    status: "Approved",
    drafted_by: { kind: "agent", agent: REVIEWER },
    created: "2026-01-01T00:00:00Z",
    predicted: { horizon_days: 30 },
    comparators: ["x"],
  };
  assert.match(reviewBlockers(rec, NOW).join(" "), /never reviews a proposal it drafted/);
});

test("only an approved proposal past its horizon is reviewed", { skip }, () => {
  const { recs } = setup("hospitality");
  const running = recs.find((r) => r.id === "rec-example-room-pool");
  assert.match(reviewBlockers(running, NOW).join(" "), /horizon runs to/);
  const drafted = recs.find((r) => r.status === "Drafted");
  assert.match(reviewBlockers(drafted, NOW).join(" "), /only an approved proposal ran/);
  const closed = recs.find((r) => r.status === "Closed");
  assert.match(reviewBlockers(closed, NOW).join(" "), /already recorded/);
  assert.ok(!finishedProposals(recs, NOW).some((v) => [running.id, drafted.id, closed.id].includes(v.id)));
});

test("an outcome is drafted, not recorded, and must say how it was measured", { skip }, () => {
  const { recs, measureCtx } = setup("hospitality");
  const rec = recs.find((r) => r.id === "rec-example-kitchen-roster");
  const m = measureProposal(rec, measureCtx);
  const o = draftOutcome(rec, { saving_rand: m.measured_saving_rand.mid, basis: "Comparison with frozen comparators.", measured: m, now: NOW });
  assert.equal(o.drafted_by.agent, REVIEWER);
  assert.equal(rec.status, "Approved", "drafting must not change the proposal");
  assert.ok(!("status" in o));
  assert.throws(() => draftOutcome(rec, { saving_rand: 1, basis: "", now: NOW }), /how the actual saving was measured/i);
  assert.throws(
    () => draftOutcome(recs.find((r) => r.id === "rec-example-room-pool"), { saving_rand: 1, basis: "x", now: NOW }),
    /horizon runs to/,
  );
});

test("proposals a browser sends are checked before the Reviewer sees them", { skip }, () => {
  const { recs, context } = setup("hospitality");
  const good = { ...recs.find((r) => r.id === "rec-example-room-pool"), id: "rec-local-1" };
  const withPerson = { ...good, id: "rec-local-2", employee_id: "E123" };
  const badTarget = { ...good, id: "rec-local-3", target: [{ dimension: "cohort_department", cohort: "Nowhere" }] };
  const notARecord = "rec-local-4";
  const accepted = acceptProposals(recs, [good, withPerson, badTarget, notARecord], context);
  const ids = accepted.map((r) => r.id);
  assert.ok(ids.includes("rec-local-1"));
  assert.ok(!ids.includes("rec-local-2"));
  assert.ok(!ids.includes("rec-local-3"));
  assert.equal(accepted.length, recs.length + 1);
});

test("the shortfall is worked out in code, for the agent to quote", { skip }, () => {
  const { recs, measureCtx } = setup("hospitality");
  const m = measureProposal(recs.find((r) => r.id === "rec-example-kitchen-roster"), measureCtx);
  assert.equal(m.shortfall_rand, m.predicted_saving_rand - m.measured_saving_rand.mid);
  const { recs: base, measureCtx: baseCtx } = setup("base");
  const b = measureProposal(base.find((r) => r.id === "rec-example-hours"), baseCtx);
  assert.ok(b.shortfall_rand >= 0);
});
