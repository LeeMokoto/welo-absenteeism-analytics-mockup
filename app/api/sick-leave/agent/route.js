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

const MODEL = process.env.SICK_LEAVE_AGENT_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 1200;

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
    const status = err?.status || 502;
    return json(
      { error: "The agent request failed. Check the service configuration and try again." },
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
