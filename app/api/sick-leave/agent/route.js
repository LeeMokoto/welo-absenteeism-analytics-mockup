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
import { SYSTEM_PROMPTS } from "@/lib/sick-leave/agentPrompts";
import { AGENT_IDS } from "@/lib/sick-leave/agentMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.SICK_LEAVE_AGENT_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 1200;

// Config check for debugging a deployment: reports whether a key is present and
// which model is configured. It never returns the key or any part of it, and it
// makes no upstream call, so it costs nothing and is safe to hit from a browser.
export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY || "";
  return json({
    keyConfigured: Boolean(key),
    keyLooksValid: /^sk-ant-/.test(key),
    model: MODEL,
    modelFromEnv: Boolean(process.env.SICK_LEAVE_AGENT_MODEL),
    agents: AGENT_IDS,
  });
}

export async function POST(request) {
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
    // Agents are disabled without a key. The client renders the panels in a
    // disabled state, but guard here too in case the route is called directly.
    return json(
      { error: "The agent service is not configured. No ANTHROPIC_API_KEY is set." },
      503
    );
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
      system: SYSTEM_PROMPTS[agent],
      messages: [{ role: "user", content: userContent }],
    });
    const text = (message.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return json({ text, model: MODEL });
  } catch (err) {
    const status = Number(err?.status) || 0;
    // Log the real error server side (visible in the platform's function logs).
    // Redact anything key-shaped first: an SDK error can echo request context.
    console.error(
      "[sick-leave agent] request failed",
      JSON.stringify({
        agent,
        model: MODEL,
        status: status || null,
        type: err?.error?.error?.type || err?.name || null,
        message: redact(err?.error?.error?.message || err?.message || String(err)),
      })
    );
    return json(
      { error: explain(status, err), model: MODEL },
      status >= 400 && status < 600 ? status : 502
    );
  }
}

// Turn an upstream failure into something the operator can act on. These
// messages are shown in the dashboard, so they name the likely fix and never
// include credentials.
function explain(status, err) {
  switch (status) {
    case 401:
      return "The Anthropic API key was rejected. Check the key configured for this deployment.";
    case 403:
      return "The Anthropic API key is not permitted to make this request. Check the key's permissions.";
    case 404:
      return `The model "${MODEL}" is not available to this account. Set SICK_LEAVE_AGENT_MODEL to a model the account can use, then redeploy.`;
    case 400:
      return `The request was rejected as invalid, which usually means the model id "${MODEL}" is wrong. ${redact(err?.error?.error?.message || "")}`.trim();
    case 429:
      return "Rate limited by the Anthropic API, or the account is out of credit. Wait a moment, or check the billing and spend cap.";
    case 500:
    case 502:
    case 503:
    case 529:
      return "The Anthropic API is temporarily unavailable. Try again in a moment.";
    default:
      return `The agent request did not complete${status ? ` (status ${status})` : ""}. The reason is in the server logs.`;
  }
}

// Never echo anything key-shaped back to the browser or into a log line.
function redact(s) {
  return String(s || "").replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
