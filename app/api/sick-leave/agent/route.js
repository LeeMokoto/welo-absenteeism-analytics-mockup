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
import { canAnswer, fallbackAnswer, refusal } from "@/modules/sick-leave/agentFallback";
import { agentFailureLog, explainAgentFailure, redact } from "@/lib/platform/agentErrors";
import { requirePermission } from "@/lib/platform/session";
import { PERMISSIONS } from "@/lib/platform/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.SICK_LEAVE_AGENT_MODEL || "claude-sonnet-5-5";
const MAX_TOKENS = 1200;

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

export async function POST(request) {
  // The solution design puts the role check in the API, so a hidden menu item
  // is never the only control. A caller with a session that may not use the
  // agents is refused here even though the panel is not rendered for them.
  {
    const { allowed } = await requirePermission(PERMISSIONS.USE_AGENTS);
    if (!allowed) {
      return Response.json({ error: "This role may not use the agents." }, { status: 403 });
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body was not valid JSON." }, 400);
  }

  const { agent, question, context } = body || {};

  if (!agent || !AGENT_IDS.includes(agent)) {
    return json({ error: "Unknown agent." }, 400);
  }
  if (typeof question !== "string" || !question.trim()) {
    return json({ error: "A question is required." }, 400);
  }
  if (context == null || typeof context !== "object") {
    return json({ error: "Grounding context is required." }, 400);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    /*
      No key, so no model. This used to return 503 and the panels rendered an
      "Agent offline" box, which left three of the four agent surfaces in the
      demo dark: a visitor saw the cohorts, the costs and the governance, then
      three empty boxes where the thing being sold should have been.

      Instead the panel's own suggested questions are answered from the
      grounding the screen already assembled, by arithmetic. It is labelled at
      every layer: the answer opens by saying no language model was called,
      `source` is `summary` rather than `model`, and the panel badges it.

      A question outside the suggested set is refused by name rather than
      answered generically. A canned paragraph returned for any input is what
      would make a buyer think the product is cleverer than it is.
    */
    const text = fallbackAnswer(agent, question, context);
    if (text) {
      return json({ text, model: null, source: "summary" });
    }
    return json({
      text: refusal(agent, AGENTS[agent]?.chips || []),
      model: null,
      source: "summary",
      answered: false,
    });
  }

  const client = new Anthropic({ apiKey });

  const userContent =
    "CONTEXT (the sample figures currently on screen, reason only over this):\n" +
    "```json\n" +
    JSON.stringify(context, null, 2) +
    "\n```\n\nQUESTION:\n" +
    question.trim();

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      /*
        The system prompt is marked cacheable and thinking is adaptive, which
        is what the Python service has always done. These routes did not, so
        the two deployments answered the same questions with different
        reasoning effort and the Vercel one paid for the same system prompt on
        every call. The prompt is stable and the grounding is what varies, so
        it caches well.
      */
      system: [{ type: "text", text: SYSTEM_PROMPTS[agent], cache_control: { type: "ephemeral" } }],
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: userContent }],
    });
    const text = (message.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const usage = message.usage || {};
    return json({
      text,
      model: MODEL,
      source: "model",
      // Surfaced so a cold call and a cached one are distinguishable when
      // somebody is working out what the agents actually cost.
      usage: {
        input_tokens: usage.input_tokens ?? null,
        output_tokens: usage.output_tokens ?? null,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
      },
    });
  } catch (err) {
    const status = Number(err?.status) || 0;
    // Log the real error server side (visible in the platform's function logs).
    // Redact anything key-shaped first: an SDK error can echo request context.
    console.error(...agentFailureLog("sick-leave agent", { agent, model: MODEL, err }));
    return json(
      {
        error: explainAgentFailure(status, err, {
          model: MODEL,
          modelEnvVar: "SICK_LEAVE_AGENT_MODEL",
        }),
        model: MODEL,
      },
      status >= 400 && status < 600 ? status : 502
    );
  }
}


function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
