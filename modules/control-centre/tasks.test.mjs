import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DESTINATIONS,
  OWNER_DESTINATION,
  TASK_STATUSES,
  blockers,
  buildTask,
  canDispatch,
  describeTask,
  destinationFor,
  dispatchable,
  instructionRefusals,
  openTaskFor,
  stepKey,
} from "./tasks.js";
import { STEP_OWNERS } from "./playbooks.js";

/*
  A task is the only thing in this product that leaves the platform, so these
  tests are the ways one could wrongly get out: without an approval, from a
  rejected plan, carrying a person, carrying an instruction a playbook step
  would have been refused for, twice for one step, or sent by the person who
  approved it.
*/

const STEP = {
  action: "Cap consecutive shifts across the cohort and hold a rest-day floor.",
  owner: "Shift scheduling",
  horizon: "immediate",
  measure: "absent_days_per_head_annual",
};

const INTERVENTION = {
  id: "icv-001",
  title: "Rostering review",
  target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
};

const approved = (over = {}) => ({
  id: "pb-001",
  intervention_id: "icv-001",
  title: "Playbook for Rostering review",
  status: "Approved",
  drafted_by: "sipho.dlamini@example.com",
  drafted_by_role: "analyst",
  steps: [STEP],
  approval: {
    by: "naledi.khumalo@example.com",
    by_role: "approver",
    at: "2026-08-18",
    decision: "approved",
  },
  ...over,
});

const SESSION = { email: "sipho.dlamini@example.com", role: "analyst" };

// --- The gate ---------------------------------------------------------------

test("an approved step with a queue can be sent", () => {
  assert.deepEqual(blockers(approved(), STEP), []);
  assert.equal(canDispatch(approved(), STEP), true);
});

test("nothing leaves without an approval", () => {
  for (const status of ["Drafted", "In review"]) {
    const why = blockers(approved({ status, approval: null }), STEP);
    assert.ok(why.length, `${status} produced no blocker`);
    assert.ok(
      why.some((b) => b.includes("not been approved") || b.includes("no recorded approval")),
      `${status}: ${why.join(" | ")}`,
    );
  }
});

test("a rejected playbook sends nothing, and says that is why", () => {
  const why = blockers(approved({ status: "Rejected" }), STEP);
  assert.ok(why.some((b) => b.includes("rejected")));
  assert.equal(canDispatch(approved({ status: "Rejected" }), STEP), false);
});

test("a superseded playbook sends nothing", () => {
  const why = blockers(approved({ status: "Superseded" }), STEP);
  assert.ok(why.some((b) => b.includes("superseded")));
});

test("a status of Approved with no approval block is not an approval", () => {
  // The status is caller-supplied; the approval is the thing that permits it.
  const why = blockers(approved({ approval: null }), STEP);
  assert.ok(why.some((b) => b.includes("no recorded approval")));
});

test("an approval recorded as rejected does not permit a task", () => {
  const why = blockers(
    approved({ approval: { by: "x@example.com", by_role: "approver", at: "2026-08-18", decision: "rejected" } }),
    STEP,
  );
  assert.ok(why.some((b) => b.includes("no recorded approval")));
});

// --- No individual leaves ---------------------------------------------------

test("an instruction naming a person is refused, not cleaned", () => {
  for (const action of [
    "Speak to EMP-10432 about the roster.",
    "Email thandi.mokoena@example.com the new pattern.",
    "Check the record against 8001015009087 first.",
    "Export the employee_id column for the queue.",
  ]) {
    const refusals = instructionRefusals(action);
    assert.ok(refusals.length, `not refused: ${action}`);
    const why = blockers(approved(), { ...STEP, action });
    assert.ok(why.some((b) => b.includes("naming a person")), `${action}: ${why.join(" | ")}`);
  }
});

test("the screens run again at dispatch, not only at drafting", () => {
  /*
    The point of re-checking. A step is validated when the playbook is written;
    a task is the thing that actually goes, and the text can have been edited
    in between. This simulates exactly that: an approved playbook whose step
    has since been changed to something that would never have passed.
  */
  const edited = { ...STEP, action: "Where absence continues, begin a disciplinary process." };
  const why = blockers(approved({ steps: [edited] }), edited);
  assert.ok(why.some((b) => b.includes("disciplinary")), why.join(" | "));
  assert.equal(canDispatch(approved({ steps: [edited] }), edited), false);
});

test("a cohort-level instruction is not mistaken for an individual one", () => {
  assert.deepEqual(instructionRefusals(STEP.action), []);
  assert.deepEqual(
    instructionRefusals("Offer screening to the whole cohort, applied to the roster rather than to individuals."),
    [],
  );
});

// --- A step sends once ------------------------------------------------------

test("a step already sent cannot be sent again", () => {
  const existing = [
    { playbook_id: "pb-001", step_key: stepKey(STEP), status: "Dispatched", dispatched_at: "2026-10-01" },
  ];
  const why = blockers(approved(), STEP, { existingTasks: existing });
  assert.ok(why.some((b) => b.includes("already sent")), why.join(" | "));
});

test("a cancelled task does not block a resend", () => {
  const existing = [
    { playbook_id: "pb-001", step_key: stepKey(STEP), status: "Cancelled", dispatched_at: "2026-10-01" },
  ];
  assert.deepEqual(blockers(approved(), STEP, { existingTasks: existing }), []);
});

test("the step key is stable against whitespace and case but not against meaning", () => {
  assert.equal(stepKey(STEP), stepKey({ ...STEP, action: `  ${STEP.action.toUpperCase()}  ` }));
  assert.notEqual(stepKey(STEP), stepKey({ ...STEP, action: "Something else entirely." }));
});

test("openTaskFor finds a task only for its own playbook and step", () => {
  const tasks = [{ playbook_id: "pb-001", step_key: "a", status: "Dispatched" }];
  assert.ok(openTaskFor(tasks, "pb-001", "a"));
  assert.equal(openTaskFor(tasks, "pb-002", "a"), null);
  assert.equal(openTaskFor(tasks, "pb-001", "b"), null);
});

// --- Destinations are queues, not people ------------------------------------

test("every step owner has a queue, and every queue exists", () => {
  for (const owner of STEP_OWNERS) {
    const key = OWNER_DESTINATION[owner];
    assert.ok(key, `no queue configured for ${owner}`);
    assert.ok(DESTINATIONS.some((d) => d.key === key), `${owner} points at a missing queue ${key}`);
  }
});

test("no destination is a person's name", () => {
  for (const d of DESTINATIONS) {
    assert.ok(
      !/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(d.label),
      `${d.label} reads as a person rather than a queue`,
    );
    assert.ok(d.detail && d.detail.length > 20, `${d.key} has no usable description`);
  }
});

test("a step whose owner has no queue cannot be sent", () => {
  const why = blockers(approved(), { ...STEP, owner: "Someone invented" });
  assert.ok(why.some((b) => b.includes("no queue is configured")));
  assert.equal(destinationFor({ owner: "Someone invented" }), null);
});

// --- What the task carries --------------------------------------------------

test("a task inherits its target and states nothing of its own", () => {
  const task = buildTask(approved(), STEP, INTERVENTION, SESSION);
  assert.deepEqual(task.target, INTERVENTION.target);
  assert.equal(task.intervention_id, "icv-001");
  assert.equal(task.playbook_id, "pb-001");
});

test("a task records who approved it and who released it, and they differ", () => {
  const task = buildTask(approved(), STEP, INTERVENTION, SESSION);
  assert.equal(task.approved_by_role, "approver");
  assert.equal(task.dispatched_by_role, "analyst");
  assert.notEqual(task.approved_by, task.dispatched_by);
});

test("a task says it was not sent, on the record and not only on screen", () => {
  const task = buildTask(approved(), STEP, INTERVENTION, SESSION);
  assert.equal(task.transport, "mock");
  assert.match(task.transport_note, /Recorded, not sent/);
  assert.match(task.transport_note, /received nothing/);
});

test("a task carries no individual field", () => {
  const task = buildTask(approved(), STEP, INTERVENTION, SESSION);
  for (const field of ["employee_id", "employee_key", "name", "email", "individuals"]) {
    assert.ok(!(field in task), `the task carries ${field}`);
  }
});

test("the description says recorded rather than sent", () => {
  const text = describeTask(buildTask(approved(), STEP, INTERVENTION, SESSION));
  assert.match(text, /Recorded for/);
  assert.ok(!/\bsent\b/i.test(text), `the description claims it was sent: ${text}`);
  // And it carries the authority, so a queue reader can see whose decision it was.
  assert.match(text, /on the authority of the approver decision/);
});

// --- The list the screen renders -------------------------------------------

test("dispatchable lists every step, sendable or not, with the reason", () => {
  const playbook = approved({
    steps: [STEP, { ...STEP, action: "Begin a disciplinary process.", owner: "HR business partner" }],
  });
  const rows = dispatchable(playbook);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[1].ok, false);
  assert.ok(rows[1].blockers.length, "a step that cannot be sent must say why");
  // Not filtered: a step that cannot be sent is the more interesting row.
  assert.ok(rows.every((r) => r.step));
});

test("the statuses are the ones the screens rely on", () => {
  assert.deepEqual(TASK_STATUSES, ["Ready", "Dispatched", "Acknowledged", "Cancelled"]);
});
