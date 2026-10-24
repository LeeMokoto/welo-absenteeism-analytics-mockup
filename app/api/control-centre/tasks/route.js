/*
  Authorisation for sending a playbook step out of the platform.

  This is the only endpoint in the product whose purpose is to make something
  leave, so the checks are here rather than in the screen, and they run again
  even though the playbook was validated when it was drafted. A step is
  checked when a plan is written; a task is the thing that actually goes. The
  text can have been edited in between, and checking once and trusting forever
  is how the second version gets out.

  **Dispatch needs CONTROL_CREATE, not CONTROL_APPROVE.** Approval is the gate:
  an approver decides whether this may ever leave, and the people doing the
  work release it. Giving dispatch to the approver would make the approver the
  doer and collapse the separation the role exists for. So the Approver can
  permit a task and cannot send one, which is the right way round.

  **The playbook is taken from the body and re-checked, not trusted.** It may
  have come from browser storage, so its status and its approval are
  caller-supplied however they got there. A body claiming `status: "Approved"`
  with no approval block is refused, and so is one whose approval says
  `rejected`.

  Nothing is actually sent. The response says so and the stored record says so,
  because a task that looks sent and was not is the most expensive mock in here
  to get wrong.
*/

import { requirePermission } from "@/lib/platform/session";
import { PERMISSIONS, can } from "@/lib/platform/roles";
import { getManifest } from "@/lib/platform/manifest";
import { blockers, buildTask, stepKey } from "@/modules/control-centre/tasks";
import { canSaveIntervention } from "@/modules/control-centre/targeting";
import { carriesIndividual } from "@/modules/control-centre/store";
import { portfolio } from "@/modules/absence/data/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const { session, allowed } = await requirePermission(PERMISSIONS.CONTROL_CREATE);
  if (!allowed) {
    return Response.json(
      {
        error:
          "This role may not send tasks. Approval permits a task to leave the platform; releasing it belongs to the people doing the work.",
      },
      { status: 403 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body was not valid JSON." }, { status: 400 });
  }

  const { playbook, step, intervention, existingTasks } = body || {};
  if (!playbook || !step || !intervention) {
    return Response.json(
      { error: "A playbook, a step and the intervention it hangs off are all required." },
      { status: 400 },
    );
  }

  if (carriesIndividual(playbook) || carriesIndividual(step) || carriesIndividual(intervention)) {
    return Response.json(
      { error: "The request carried an individual identifier. Nothing about a person leaves this platform." },
      { status: 422 },
    );
  }

  /*
    The approval, re-derived rather than believed. A body can claim any status
    it likes; what permits a task is an approval block naming who decided and
    when, by somebody other than the drafter.
  */
  if (playbook.approval && playbook.approval.by && playbook.approval.by === playbook.drafted_by) {
    return Response.json(
      {
        error:
          "This playbook records the same person as drafter and approver, which is not an approval. A task cannot leave on it.",
      },
      { status: 422 },
    );
  }

  const why = blockers(playbook, step, { existingTasks: existingTasks || [] });
  if (why.length) {
    return Response.json({ error: why.join(" "), errors: why }, { status: 422 });
  }

  /*
    And the target the task will carry has to still be reportable. An
    intervention validated months ago can have a cohort that has since fallen
    under the threshold, and a task naming it would put a sub-threshold cohort
    into somebody's work queue.
  */
  const manifest = getManifest();
  const targetCheck = canSaveIntervention(intervention.target, {
    dimensions: portfolio.cohort_dimensions || [],
    cohorts: portfolio.cohorts || {},
    suppressionThreshold: manifest.suppressionThreshold,
  });
  if (!targetCheck.ok) {
    return Response.json(
      {
        error:
          "The cohort this task would name is no longer reportable, so it cannot be sent. " +
          targetCheck.errors.join(" "),
        errors: targetCheck.errors,
      },
      { status: 422 },
    );
  }

  const task = buildTask(playbook, step, intervention, session);

  return Response.json({
    task,
    step_key: stepKey(step),
    sent: false,
    transport: "mock",
    note:
      "Authorised and recorded, not sent. This tenant has no outbound integration: nothing left this deployment and the queue named received nothing. The authority for it is the approval recorded on the playbook.",
    // Said here as well as on the record, because a caller reading only the
    // response should not have to infer it.
    approved_by_role: playbook.approval?.by_role || null,
    dispatched_by_role: session.role,
    separation:
      can(session, PERMISSIONS.CONTROL_APPROVE)
        ? "This session holds both create and approve, which the role table is supposed to prevent. Check lib/platform/roles.js."
        : null,
  });
}
