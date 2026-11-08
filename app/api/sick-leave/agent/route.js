/*
  Agent route for the Sick Leave Intelligence dashboard.

  - The Anthropic API key is read from process.env.ANTHROPIC_API_KEY server side
    only and never reaches the client.
  - Accepts { agent, question, context }. Rejects any agent that is not one of
    the three known identifiers.
  - The agent reasons only over the supplied context (grounding). The system
    prompts instruct it to say a figure is missing rather than estimate.
*/

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPTS } from "@/modules/sick-leave/agentPrompts";
import { AGENT_IDS, AGENTS } from "@/modules/sick-leave/agentMeta";
import { fallbackAnswer, refusal } from "@/modules/sick-leave/agentFallback";
import { redact } from "@/lib/platform/agentErrors";
import { createAgentHandler, json } from "@/lib/platform/agentHandler";
import { requirePermission } from "@/lib/platform/session";
import { PERMISSIONS } from "@/lib/platform/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.SICK_LEAVE_AGENT_MODEL || "claude-sonnet-5-5";

// Config check for debugging a deployment: reports whether a key is present and
// which model is configured. It never returns the key or any part of it.
//
// Add ?models=1 to also list the model ids this account can actually use, and
// say whether the configured one is among them. That calls the Models API,
// which consumes no tokens, and is the quickest way to diagnose a request that
// is being rejected for the model rather than the credentials.
export async function GET(request) {
  // The solution design puts the role check in the API, so a hidden menu item
  // is never the only control. A caller with a session that may not use the
  // agents is refused here even though the panel is not rendered for them.
  {
    const { allowed } = await requirePermission(PERMISSIONS.USE_AGENTS);
    if (!allowed) {
      return Response.json({ error: "This role may not use the agents." }, { status: 403 });
    }
  }

  const key = process.env.ANTHROPIC_API_KEY || "";
  const out = {
    keyConfigured: Boolean(key),
    keyLooksValid: /^sk-ant-/.test(key),
    model: MODEL,
    modelFromEnv: Boolean(process.env.SICK_LEAVE_AGENT_MODEL),
    agents: AGENT_IDS,
  };

  const wantModels = new URL(request.url).searchParams.get("models");
  if (wantModels && key) {
    try {
      const list = await new Anthropic({ apiKey: key }).models.list({ limit: 50 });
      const ids = (list?.data || []).map((m) => m.id);
      out.availableModels = ids;
      out.configuredModelAvailable = ids.includes(MODEL);
    } catch (err) {
      out.modelsLookupError = redact(
        err?.error?.error?.message || err?.message || String(err)
      );
      out.modelsLookupStatus = Number(err?.status) || null;
    }
  }

  return json(out);
}

/*
  The POST body now comes from the shared handler, so the permission check, the
  no-key branch and the redaction on the error path are the same code the
  absence route runs. They used to be written out here, and a second
  hand-written copy for absence would have been the place one of them quietly
  stopped happening.

  The GET diagnostic above stays local: it reports on this route's own key and
  model and has no counterpart to share with.
*/
export const POST = createAgentHandler({
  agents: AGENT_IDS,
  promptFor: (agent) => SYSTEM_PROMPTS[agent],
  fallback: {
    answer: fallbackAnswer,
    refusal,
    chipsFor: (agent) => AGENTS[agent]?.chips || [],
  },
  model: MODEL,
  modelEnvVar: "SICK_LEAVE_AGENT_MODEL",
  scope: "sick-leave agent",
});
