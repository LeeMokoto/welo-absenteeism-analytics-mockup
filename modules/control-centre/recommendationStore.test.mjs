import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/*
  The browser-local proposals store. Worth testing because it is a mock: the
  floor it enforces is the one the real store will be built to. A draft cannot
  arrive decided, a status only moves forward by one allowed step, and the
  prediction a decision was made on cannot be edited afterwards, or the track
  record would compare outcomes against numbers nobody approved.
*/

const stored = {};
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => {
      stored[k] = String(v);
    },
    removeItem: (k) => {
      delete stored[k];
    },
  },
};

const { applyUpdate, clearLocalRecommendations, exampleRecommendations, listRecommendations, saveDrafts } = await import(
  "./recommendationStore.js"
);
const { buildRecommendation, decide, trackRecord, validateRecommendation } = await import("./recommendations.js");
const { screenOutput } = await import("../../lib/platform/agentTools.js");
const { portfolio } = await import("../absence/data/portfolio.js");

const context = { dimensions: portfolio.cohort_dimensions, cohorts: portfolio.cohorts };
const approver = { email: "naledi.khumalo@example.com", role: "approver", permissions: [] };

const draft = () =>
  buildRecommendation(
    {
      kind: "cover_booking",
      title: "Standby cover for standard operations",
      rationale: "Cover gaps cluster at month end.",
      target: [{ dimension: "cohort_load", cohort: "Standard ops" }],
      predicted: { saving_rand: 50000, cost_rand: 20000, basis: "Cover-gap days at the cover-day rate.", horizon_days: 30 },
    },
    { agent: "coordinator", requestedBy: "sipho.dlamini@example.com", dataVersion: "run" },
    context,
  );

beforeEach(() => clearLocalRecommendations());

// --- The examples ---------------------------------------------------------------

test("the examples show every status, and are marked as examples", () => {
  const ex = exampleRecommendations(context);
  assert.deepEqual([...new Set(ex.map((r) => r.status))].sort(), ["Approved", "Closed", "Drafted", "Rejected"]);
  assert.ok(ex.every((r) => r.example === true));
});

test("the examples would pass every rule a real draft goes through", () => {
  for (const r of exampleRecommendations(context)) {
    assert.deepEqual(validateRecommendation(r, context).errors, [], r.id);
    assert.deepEqual(screenOutput(r), [], r.id);
  }
});

test("the examples alone are too few to judge, which is what a visitor sees first", () => {
  const t = trackRecord(exampleRecommendations(context));
  assert.equal(t.enough, false);
  assert.equal(t.closed, 2);
});

test("the examples are the same on every call, so the server and browser render match", () => {
  assert.deepEqual(exampleRecommendations(context), exampleRecommendations(context));
});

// --- Saving drafts ----------------------------------------------------------------

test("an agent's draft is saved and listed", () => {
  const d = draft();
  const r = saveDrafts([d]);
  assert.equal(r.saved.length, 1);
  assert.ok(listRecommendations(context).some((x) => x.id === d.id && x.example === false));
});

test("a draft cannot arrive already approved", () => {
  const approved = decide(draft(), { decision: "Approved", session: approver, hasApprovePermission: true });
  const r = saveDrafts([approved]);
  assert.equal(r.saved.length, 0);
  assert.match(r.refused[0].reason, /undecided draft/);
});

test("a draft carrying a person's identifier is refused, not cleaned", () => {
  const r = saveDrafts([{ ...draft(), employee_key: "EMP-10432" }]);
  assert.equal(r.saved.length, 0);
  assert.ok(!JSON.stringify(stored).includes("EMP-10432"));
});

test("the same draft is not saved twice", () => {
  const d = draft();
  saveDrafts([d]);
  assert.equal(saveDrafts([d]).saved.length, 0);
});

// --- Moving a record forward ------------------------------------------------------

test("a draft becomes approved when the update carries the decision", () => {
  const d = draft();
  saveDrafts([d]);
  const updated = decide(d, { decision: "Approved", session: approver, hasApprovePermission: true });
  assert.equal(applyUpdate(d, updated).ok, true);
  assert.equal(listRecommendations(context).find((x) => x.id === d.id).status, "Approved");
});

test("a status cannot skip a step or go backwards", () => {
  const d = draft();
  assert.equal(applyUpdate(d, { ...d, status: "Closed", actual: { saving_rand: 1 } }).ok, false);
  const approved = decide(d, { decision: "Approved", session: approver, hasApprovePermission: true });
  assert.equal(applyUpdate(approved, { ...approved, status: "Drafted" }).ok, false);
  const rejected = decide(d, { decision: "Rejected", note: "No.", session: approver, hasApprovePermission: true });
  assert.equal(applyUpdate(rejected, { ...rejected, status: "Approved" }).ok, false);
});

test("a decision that does not say who made it is refused", () => {
  const d = draft();
  assert.equal(applyUpdate(d, { ...d, status: "Approved", decision: { decision: "Approved" } }).ok, false);
});

test("the prediction cannot be edited on the way to a decision", () => {
  const d = draft();
  const updated = decide(d, { decision: "Approved", session: approver, hasApprovePermission: true });
  const inflated = { ...updated, predicted: { ...updated.predicted, saving_rand: 5000000 } };
  const r = applyUpdate(d, inflated);
  assert.equal(r.ok, false);
  assert.match(r.reason, /prediction cannot change/);
});

test("deciding an example keeps it marked as an example", () => {
  const ex = exampleRecommendations(context).find((r) => r.status === "Drafted");
  const updated = decide(ex, { decision: "Rejected", note: "Not this month.", session: approver, hasApprovePermission: true });
  assert.equal(applyUpdate(ex, updated).ok, true);
  const listed = listRecommendations(context).filter((x) => x.id === ex.id);
  assert.equal(listed.length, 1, "the decided example should replace the shipped one, not sit beside it");
  assert.equal(listed[0].status, "Rejected");
  assert.equal(listed[0].example, true);
});
