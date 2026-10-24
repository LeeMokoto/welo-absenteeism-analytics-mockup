/*
  Draft a playbook for an intervention.

  Deliberately not streaming, unlike the dashboard's agent panels. A streamed
  draft arrives on screen a token at a time, which means the reader sees it
  before anything has checked it, and a disciplinary step reads as a suggestion
  the product made. Here the whole draft is parsed and validated before it is
  returned, so what reaches the screen is either a plan that passes or a
  refusal that names the step and the line it crossed. A few seconds of latency
  buys that, and drafting a plan is not a keystroke-latency task.

  Two permissions, not one. USE_AGENTS because this calls a model, and
  CONTROL_CREATE because a drafted playbook is a proposal attached to a durable
  record. The Approver holds neither, which is the point: the role that decides
  does not draft.

  The draft is returned as a proposal. Nothing here approves it, nothing here
  persists it, and the response says so. POPIA section 71 is the reason that is
  a hard line rather than a workflow preference.
*/

import Anthropic from "@anthropic-ai/sdk";
import { requirePermission } from "@/lib/platform/session";
import { PERMISSIONS, can } from "@/lib/platform/roles";
import { getManifest } from "@/lib/platform/manifest";
import { canSaveIntervention } from "@/modules/control-centre/targeting";
import { parseDraft, validatePlaybook } from "@/modules/control-centre/playbooks";
import { FALLBACK_NOTICE, fallbackDraft } from "@/modules/control-centre/draftFallback";
import { portfolio } from "@/modules/absence/data/portfolio";
import { systemPromptFor, ABSENTEEISM_MODEL, MAX_TOKENS } from "@/app/api/absenteeism/_prompts";
import { agentFailureLog, explainAgentFailure } from "@/lib/platform/agentErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/*
  The grounding: the intervention, and the figures for the cohorts it targets.
  Nothing else. The agent cannot reason about a cohort the intervention does not
  name, because it is not given one, which is a stronger control than asking it
  not to.
*/
function groundingFor(intervention) {
  const cohorts = portfolio.cohorts || {};
  const dimensions = portfolio.cohort_dimensions || [];

  const targeted = (intervention.target || []).map((t) => {
    const dim = dimensions.find((d) => d.key === t.dimension);
    const row = (cohorts[t.dimension] || []).find((c) => c.key === t.cohort);
    return {
      dimension: dim?.label || t.dimension,
      cohort: t.cohort,
      // A suppressed cohort carries no figures, and the absence of them is
      // what the agent should see rather than a zero.
      figures: row && !row.suppressed ? row : null,
      suppressed: Boolean(row?.suppressed),
    };
  });

  return {
    intervention: {
      title: intervention.title,
      rationale: intervention.rationale || null,
      owner: intervention.owner || null,
      status: intervention.status || "Proposed",
    },
    targeted_cohorts: targeted,
    suppression_threshold: getManifest().suppressionThreshold,
    note: "Cohort aggregates only. No individual records exist in this payload.",
  };
}

export async function POST(request) {
  const { session, allowed } = await requirePermission(PERMISSIONS.USE_AGENTS);
  if (!allowed) {
    return Response.json({ error: "This role may not use the agents." }, { status: 403 });
  }
  if (!can(session, PERMISSIONS.CONTROL_CREATE)) {
    return Response.json(
      { error: "This role may read the control centre and not draft plans for it." },
      { status: 403 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body was not valid JSON." }, { status: 400 });
  }

  const intervention = body?.intervention;
  if (!intervention || typeof intervention !== "object") {
    return Response.json({ error: "An intervention is required." }, { status: 400 });
  }

  /*
    Re-validate the parent's target here rather than trusting it. The record may
    have come from browser storage, so the target arriving over the wire is
    caller-supplied whatever its history. If it would be refused at save, it is
    refused as a drafting basis too, which keeps one rule in one place.
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
        error: "The intervention's target does not meet the targeting rules, so no plan is drafted for it.",
        errors: targetCheck.errors,
      },
      { status: 422 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  /*
    No key, so no model. The endpoint used to return 503 here, which meant the
    one thing this screen exists to show, that a plan is drafted, checked and
    decided by someone who did not draft it, could not be shown at all in a
    deployment without a secret. The governance does not depend on the model, so
    neither does the demonstration of it.

    The fallback is labelled at every layer: `drafted_with: "template"` on the
    record, a notice in this response, and a badge on the screen. It also goes
    through exactly the same validation below, because a template that skipped
    the checks would make the checks look like theatre.
  */
  if (!apiKey) {
    const draft = fallbackDraft(intervention, portfolio.cohorts || {});
    return Response.json(
      buildProposal(intervention, session, draft, {
        model: null,
        source: "template",
        notice: FALLBACK_NOTICE,
      }),
    );
  }

  const system = systemPromptFor("playbook");
  if (!system) {
    return Response.json({ error: "The playbook agent is not configured." }, { status: 500 });
  }

  let text;
  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: ABSENTEEISM_MODEL,
      max_tokens: MAX_TOKENS,
      // Drafting a plan is the most consequential agent call in the product,
      // so adaptive thinking matters most here. The system prompt carries the
      // whole output contract and every constraint, so it caches well.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      thinking: { type: "adaptive" },
      messages: [
        {
          role: "user",
          content:
            "DATA (the intervention and the cohort figures behind it):\n```json\n" +
            JSON.stringify(groundingFor(intervention), null, 2) +
            "\n```\n\nREQUEST:\nDraft the playbook for this intervention.",
        },
      ],
    });
    text = (message.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  } catch (err) {
    console.error(...agentFailureLog("control-centre playbook", { agent: "playbook", model: ABSENTEEISM_MODEL, err }));
    /*
      Explained rather than reported. "The drafting request failed" tells an
      operator nothing, and this is the most consequential agent call in the
      product, so it names the likely fix the way the sick-leave route always
      has. The upstream status is preserved where it is one, so a 401 does not
      arrive as a 502 and send somebody looking at the wrong thing.
    */
    const status = Number(err?.status) || 0;
    return Response.json(
      {
        error: explainAgentFailure(status, err, {
          model: ABSENTEEISM_MODEL,
          modelEnvVar: "WELO_AGENT_MODEL",
        }),
        model: ABSENTEEISM_MODEL,
      },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }

  const { steps, why } = parseDraft(text);

  return Response.json(
    buildProposal(intervention, session, { steps, why, drafted_with: "agent" }, {
      model: ABSENTEEISM_MODEL,
      source: "agent",
      notice: null,
    }),
  );
}

/*
  One construction for both paths, so the model draft and the template draft are
  validated identically and shaped identically. Two code paths building a
  proposal is how one of them quietly stops being checked.

  A refused draft comes back with a 200 and the reasons, not an error status.
  The request succeeded: something was produced and the platform refused part of
  it, and that refusal is information the drafter should see attributed to the
  step it came from. Returning a 4xx would make the screen treat it as a failure
  and hide the one thing worth reading.
*/
function buildProposal(intervention, session, draft, { model, source, notice }) {
  const proposal = {
    intervention_id: intervention.id,
    title: `Playbook for ${intervention.title}`,
    steps: draft.steps,
    why: draft.why,
    status: "Drafted",
    drafted_by: session.email,
    drafted_by_role: session.role,
    drafted_with: draft.drafted_with,
    drafted_at: new Date().toISOString().slice(0, 10),
  };

  const check = validatePlaybook(proposal, { intervention });

  return {
    proposal,
    ok: check.ok,
    errors: check.errors,
    model,
    source,
    notice,
    decided: false,
    note: "A proposal, not a decision. It is recorded only once a person with the approver role accepts it, and that person cannot be the drafter.",
  };
}
