/*
  Outbound tasks: the point where the platform stops advising and acts.

  A task is one step of an approved playbook, addressed to the function that
  owns it, leaving the platform. It is the only thing in this product that
  reaches outside, so it carries the tightest rules in it.

  **No approved playbook, no task.** This is the gate and it is the whole
  reason the approval flow exists. A Drafted, In review, Rejected or Superseded
  playbook produces nothing. `blockers` says which, by name, because "cannot
  dispatch" with no reason reads as a bug.

  **A task has no target of its own.** It inherits the playbook's, which
  inherits the intervention's. One place states who a thing is about, and a
  task three levels down cannot widen it.

  **Dispatching is not approving.** Dispatch needs CONTROL_CREATE, not
  CONTROL_APPROVE. Approval is the gate: the approver decides whether this may
  ever leave, and then the people doing the work release it. Giving dispatch to
  the approver would make the approver the doer and collapse the separation the
  role exists for.

  **No individual leaves the platform.** Everything else in this product is
  cohort level by construction, because it reads aggregates. A task is free
  text addressed to a human, which makes it the one place somebody could type a
  name and have the platform send it. So the instruction is screened for an
  identifier and for the language a playbook step would be refused for, and a
  task that fails is refused rather than cleaned: a cleaned instruction that no
  longer says what the sender meant is worse than a refusal they can see.

  **A step dispatches once.** Two tasks for one step means two people doing the
  same thing, or one doing it twice. `openTaskFor` is how a caller checks, and
  the store refuses a duplicate as well, so it does not depend on the interface
  asking.

  The sending itself is mocked. Nothing leaves this deployment, the record says
  `mock` and the interface says so, because a task that looks sent and was not
  is the most expensive kind of mock to get wrong.
*/

import { individualReferenceIn, refusedLanguageIn, horizon } from "./playbooks.js";

export const TASK_STATUSES = ["Ready", "Dispatched", "Acknowledged", "Cancelled"];

/*
  Where a task can go. Queues and functions, never a person: a task addressed
  to a named individual is a task that stops working the day they leave, and a
  record naming them is a record about them.
*/
export const DESTINATIONS = [
  {
    key: "roster_queue",
    label: "Shift scheduling queue",
    detail: "The rostering team's work queue. For shift, rest-day and relief-pool changes.",
  },
  {
    key: "oh_clinic",
    label: "Occupational health clinic",
    detail: "The on-site clinic's intake. For screening offers and care pathway routing.",
  },
  {
    key: "hr_queue",
    label: "HR operations queue",
    detail: "For conversations, induction changes and anything needing an HR business partner.",
  },
  {
    key: "hse_queue",
    label: "Health and safety queue",
    detail: "For briefings, risk assessments and anything the HSE function owns.",
  },
];

// Which destination a step owner goes to by default. The owner is already
// recorded on the step, so making the sender choose again is an invitation to
// choose wrongly.
export const OWNER_DESTINATION = {
  "Shift scheduling": "roster_queue",
  "Occupational health": "oh_clinic",
  "HR business partner": "hr_queue",
  "Operations lead": "roster_queue",
  "Wellness programme": "oh_clinic",
  "Health and safety": "hse_queue",
};

export function destination(key) {
  return DESTINATIONS.find((d) => d.key === key) || null;
}

export function destinationFor(step) {
  return OWNER_DESTINATION[step?.owner] || null;
}

/*
  Why this step cannot be dispatched, or an empty list when it can.
*/
export function blockers(playbook, step, { existingTasks = [] } = {}) {
  const out = [];

  if (!playbook) return ["no playbook"];
  if (!step) return ["no step"];

  if (playbook.status !== "Approved") {
    out.push(
      playbook.status === "Rejected"
        ? "this playbook was rejected, so none of its steps may be sent"
        : playbook.status === "Superseded"
        ? "this playbook has been superseded by a later one"
        : `this playbook is ${String(playbook.status).toLowerCase()} and has not been approved`,
    );
  }

  if (!playbook.approval || playbook.approval.decision !== "approved") {
    out.push("no recorded approval, and an approval is what permits a task to leave the platform");
  }

  if (!destinationFor(step)) {
    out.push(
      `no queue is configured for the owner "${step.owner}", so there is nowhere for this to go`,
    );
  }

  const already = openTaskFor(existingTasks, playbook.id, stepKey(step));
  if (already) {
    out.push(
      `this step was already sent on ${already.dispatched_at || "an earlier date"}, and sending it twice means somebody does it twice`,
    );
  }

  const refusals = instructionRefusals(step.action);
  out.push(...refusals);

  return out;
}

export function canDispatch(playbook, step, opts) {
  return blockers(playbook, step, opts).length === 0;
}

/*
  Why an instruction may not leave. Separate from `blockers` so the interface
  can show it against the step's text rather than against the step.

  The same two screens a playbook step passed at drafting are run again here,
  deliberately. A step is validated when the playbook is written; a task is the
  thing that actually leaves, and the text can have been edited in between.
  Checking once and trusting forever is how the second edit gets out.
*/
export function instructionRefusals(text) {
  const out = [];
  for (const hit of individualReferenceIn(text)) {
    out.push(
      `the instruction refers to ${hit}. A task addresses a cohort through a queue, and naming a person is how health data leaves the platform about somebody.`,
    );
  }
  for (const { term, reason } of refusedLanguageIn(text)) {
    out.push(
      `the instruction reads as ${reason} ("${term}"), which is not something this platform sends anywhere.`,
    );
  }
  return out;
}

// A stable identity for a step within its playbook, so a duplicate can be
// recognised without the step carrying an id of its own.
export function stepKey(step) {
  return String(step?.action || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

export function openTaskFor(tasks, playbookId, key) {
  return (
    (tasks || []).find(
      (t) =>
        t.playbook_id === playbookId &&
        t.step_key === key &&
        t.status !== "Cancelled",
    ) || null
  );
}

/*
  Build the task. Pure: the caller persists it.

  Everything on it is either inherited or recorded, and nothing is invented.
  The approver is carried across from the playbook because the task's authority
  comes from that approval, and a reader of the queue should be able to see
  whose decision put it there without opening the platform.
*/
export function buildTask(playbook, step, intervention, session) {
  const dest = destinationFor(step);
  return {
    playbook_id: playbook.id,
    playbook_title: playbook.title,
    intervention_id: playbook.intervention_id,
    // Inherited, never restated. A task cannot name a different group.
    target: intervention?.target || [],
    step_key: stepKey(step),
    instruction: String(step.action || "").trim(),
    owner: step.owner,
    horizon: step.horizon,
    horizon_label: horizon(step.horizon)?.label || step.horizon,
    measure: step.measure || null,
    destination: dest,
    destination_label: destination(dest)?.label || dest,
    // The authority for this task existing at all.
    approved_by: playbook.approval?.by || null,
    approved_by_role: playbook.approval?.by_role || null,
    approved_at: playbook.approval?.at || null,
    dispatched_by: session?.email || null,
    dispatched_by_role: session?.role || null,
    dispatched_at: new Date().toISOString().slice(0, 10),
    status: "Dispatched",
    // Says what it is, on the record and not only in the interface.
    transport: "mock",
    transport_note:
      "Recorded, not sent. This tenant has no outbound integration: nothing left this deployment, and the queue named above received nothing.",
  };
}

/*
  The steps of a playbook, with whether each can be sent and why not.

  Returned as one list rather than filtered, because a step that cannot be sent
  is the more interesting row: the reader needs to see it and the reason, not
  an absence.
*/
export function dispatchable(playbook, { existingTasks = [] } = {}) {
  return (playbook?.steps || []).map((step, index) => {
    const why = blockers(playbook, step, { existingTasks });
    return {
      index,
      step,
      key: stepKey(step),
      destination: destinationFor(step),
      destination_label: destination(destinationFor(step))?.label || null,
      ok: why.length === 0,
      blockers: why,
      existing: openTaskFor(existingTasks, playbook?.id, stepKey(step)),
    };
  });
}

/*
  A one-line description of what a task did, for the briefing and the register.
  Phrased as recorded rather than sent, because that is what happened.
*/
export function describeTask(task) {
  if (!task) return null;
  const where = task.destination_label || task.destination || "a queue";
  return (
    `${task.horizon_label || task.horizon}: ${task.instruction} ` +
    `Recorded for ${where} on ${task.dispatched_at}, on the authority of the ` +
    `${task.approved_by_role || "approver"} decision of ${task.approved_at || "an earlier date"}.`
  );
}
