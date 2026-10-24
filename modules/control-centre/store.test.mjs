import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/*
  The mocked store.

  Worth testing precisely because it is a mock. The shape it enforces is the
  shape the real Cloud SQL store will be built to, so the controls asserted here
  are the ones that have to survive the swap: a record refers to a cohort and
  never a person, a playbook cannot be created already approved, and a decision
  cannot be recorded twice or on a record the store does not own.

  The create-then-decide flow is tested here rather than in a browser because
  drafting needs a configured agent, and the decision path is the part that
  carries the governance rule. A stubbed localStorage is enough: the store reads
  and writes through the same two calls either way.
*/

const store = {};
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
};

const {
  carriesIndividual,
  createIntervention,
  createPlaybook,
  decidePlaybook,
  clearLocal,
  clearLocalPlaybooks,
  listInterventions,
  listPlaybooks,
  seeded,
  seededPlaybooks,
  stripIndividualFields,
} = await import("./store.js");

beforeEach(() => {
  clearLocal();
  clearLocalPlaybooks();
});

// --- Seeded records are the shape the real store will hold ------------------

test("no seeded record carries an employee key", () => {
  for (const record of [...seeded(), ...seededPlaybooks()]) {
    assert.equal(carriesIndividual(record), false, `${record.id} carries an individual field`);
  }
});

test("every seeded playbook hangs off an intervention that exists", () => {
  const ids = new Set(seeded().map((i) => i.id));
  for (const pb of seededPlaybooks()) {
    assert.ok(ids.has(pb.intervention_id), `${pb.id} points at a missing intervention`);
  }
});

test("no seeded playbook carries a target of its own", () => {
  for (const pb of seededPlaybooks()) {
    assert.ok(!("target" in pb), `${pb.id} carries its own target`);
  }
});

test("the seeded set shows a decision taken by somebody other than the drafter", () => {
  const decided = seededPlaybooks().filter((p) => p.approval);
  assert.ok(decided.length >= 2, "a reviewer should see both an approval and a rejection");
  for (const pb of decided) {
    assert.notEqual(
      pb.approval.by,
      pb.drafted_by,
      `${pb.id} was approved by its own drafter, which is the thing this cannot do`,
    );
  }
  assert.ok(decided.some((p) => p.approval.decision === "rejected"), "no rejection to look at");
});

// --- Writing ----------------------------------------------------------------

test("an intervention carrying a person is cleaned before it is stored", () => {
  const { record } = createIntervention({
    title: "Rostering review",
    employee_id: 105525,
    name: "Somebody",
    target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
  });
  assert.equal(carriesIndividual(record), false);
  assert.equal(record.title, "Rostering review");
  assert.equal(listInterventions().filter((r) => carriesIndividual(r)).length, 0);
});

test("stripping removes every individual field and leaves the rest", () => {
  const out = stripIndividualFields({
    title: "keep",
    employee_key: "x",
    employee_id: 1,
    email: "a@b.c",
    individuals: [1, 2],
    owner: "keep",
  });
  assert.deepEqual(Object.keys(out).sort(), ["owner", "title"]);
});

test("a playbook cannot be created already approved", () => {
  const { record } = createPlaybook({
    intervention_id: "icv-002",
    title: "Plan",
    status: "Approved",
    approval: { by: "me@example.com", decision: "approved" },
    steps: [],
  });
  assert.equal(record.status, "Drafted");
  assert.equal(record.approval, null);
});

// --- Deciding ---------------------------------------------------------------

test("a drafted playbook can be approved once, by somebody, and the record says who", () => {
  const { record } = createPlaybook({ intervention_id: "icv-002", title: "Plan", steps: [] });

  const first = decidePlaybook(record.id, {
    decision: "approved",
    note: "Cohort level only.",
    by: "naledi.khumalo@example.com",
    byRole: "approver",
  });
  assert.equal(first.ok, true);

  const saved = listPlaybooks().find((p) => p.id === record.id);
  assert.equal(saved.status, "Approved");
  assert.equal(saved.approval.by, "naledi.khumalo@example.com");
  assert.equal(saved.approval.by_role, "approver");
  assert.equal(saved.approval.decision, "approved");
  assert.ok(saved.approval.at);

  // Twice is refused, so a decision cannot be quietly replaced.
  const second = decidePlaybook(record.id, {
    decision: "rejected",
    by: "someone.else@example.com",
    byRole: "approver",
  });
  assert.equal(second.ok, false);
  assert.ok(second.reason.includes("already been decided"));
  assert.equal(listPlaybooks().find((p) => p.id === record.id).status, "Approved");
});

test("a rejection is recorded as plainly as an approval", () => {
  const { record } = createPlaybook({ intervention_id: "icv-003", title: "Plan", steps: [] });
  const res = decidePlaybook(record.id, {
    decision: "rejected",
    note: "Step 2 is a disciplinary process.",
    by: "naledi.khumalo@example.com",
    byRole: "approver",
  });
  assert.equal(res.ok, true);
  const saved = listPlaybooks().find((p) => p.id === record.id);
  assert.equal(saved.status, "Rejected");
  assert.equal(saved.approval.note, "Step 2 is a disciplinary process.");
});

test("a seeded playbook cannot be decided, so one walkthrough cannot overwrite the next", () => {
  const seededId = seededPlaybooks()[0].id;
  const res = decidePlaybook(seededId, {
    decision: "rejected",
    by: "naledi.khumalo@example.com",
    byRole: "approver",
  });
  assert.equal(res.ok, false);
  assert.ok(res.reason.includes("drafted in this browser"));
  // And the shared record is untouched.
  assert.equal(seededPlaybooks()[0].status, "Approved");
});

test("only approved or rejected are decisions", () => {
  const { record } = createPlaybook({ intervention_id: "icv-002", title: "Plan", steps: [] });
  for (const decision of ["maybe", "", null, "Approved"]) {
    const res = decidePlaybook(record.id, { decision, by: "a@example.com", byRole: "approver" });
    assert.equal(res.ok, false, `"${decision}" was accepted as a decision`);
  }
});

test("a decision on a playbook that does not exist is refused rather than invented", () => {
  const res = decidePlaybook("pb-nope", {
    decision: "approved",
    by: "a@example.com",
    byRole: "approver",
  });
  assert.equal(res.ok, false);
});

// --- Isolation --------------------------------------------------------------

test("local records are listed after the seeded ones and marked local", () => {
  createPlaybook({ intervention_id: "icv-002", title: "Mine", steps: [] });
  const all = listPlaybooks();
  assert.equal(all.length, seededPlaybooks().length + 1);
  assert.equal(all.at(-1).source, "local");
  assert.ok(all.slice(0, seededPlaybooks().length).every((p) => p.source === "seeded"));
});

test("clearing removes only what this browser added", () => {
  createPlaybook({ intervention_id: "icv-002", title: "Mine", steps: [] });
  createIntervention({ title: "Mine", target: [] });
  clearLocalPlaybooks();
  clearLocal();
  assert.equal(listPlaybooks().length, seededPlaybooks().length);
  assert.equal(listInterventions().length, seeded().length);
});
