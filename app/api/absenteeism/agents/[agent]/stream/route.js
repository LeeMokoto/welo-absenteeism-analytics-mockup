/*
  Streaming agent endpoint for the absenteeism dashboard.

  The static dashboard POSTs { question, data } and parses Server-Sent Events
  split on a blank line, reading "event:" and "data:" lines
  (see config/agents.js). The frames it understands are:
    data: {"text": "..."}      a token chunk (default "message" event)
    event: error / data: {"error": "..."}
    event: done

  The grounding comes from the browser because it is the model output already on
  screen, so this route needs no trained model and no feed: only the key. That
  is what lets the agents run here while the what-if scoring, which does need
  the model, stays on the Python service.
*/

import Anthropic from "@anthropic-ai/sdk";
import { requirePermission } from "@/lib/platform/session";
import { PERMISSIONS } from "@/lib/platform/roles";
import {
  systemPromptFor,
  userContent,
  MAX_TOKENS,
  ABSENTEEISM_MODEL,
} from "../../../_prompts";
import { agentFailureLog, explainAgentFailure } from "@/lib/platform/agentErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function frame(event, payload) {
  const head = event ? `event: ${event}\n` : "";
  return encoder.encode(`${head}data: ${JSON.stringify(payload)}\n\n`);
}


export async function POST(request, { params }) {
  // The solution design puts the role check in the API, so a hidden menu item
  // is never the only control. A caller with a session that may not use the
  // agents is refused here even though the panel is not rendered for them.
  {
    const { allowed } = await requirePermission(PERMISSIONS.USE_AGENTS);
    if (!allowed) {
      return Response.json({ error: "This role may not use the agents." }, { status: 403 });
    }
  }

  const { agent } = await params;

  const system = systemPromptFor(agent);
  if (!system) {
    return Response.json({ error: "Unknown agent." }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // The client falls back to its built-in summary on a non-ok response, so
    // the dashboard degrades rather than dead-ending.
    return Response.json({ error: "Agent service is not configured." }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body was not valid JSON." }, { status: 400 });
  }
  const { question, data } = body || {};
  if (typeof question !== "string" || !question.trim()) {
    return Response.json({ error: "A question is required." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const run = client.messages.stream({
          model: ABSENTEEISM_MODEL,
          max_tokens: MAX_TOKENS,
          // Cached system prompt and adaptive thinking, matching the Python
          // service. The system prompt is stable across every call on this
          // route and only the grounding varies.
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          thinking: { type: "adaptive" },
          messages: [{ role: "user", content: userContent(question, data) }],
        });

        // The Node SDK's MessageStream is an event emitter: it exposes on()
        // and finalMessage(), not the Python SDK's text_stream iterator.
        run.on("text", (delta) => {
          if (delta) controller.enqueue(frame(null, { text: delta }));
        });
        // Resolves when the turn completes, rejects on an API error.
        await run.finalMessage();
        controller.enqueue(frame("done", {}));
      } catch (err) {
        console.error(...agentFailureLog("absenteeism agent", { agent, model: ABSENTEEISM_MODEL, err }));
        // Explained, not relayed. The raw upstream message is the least
        // useful thing to put in front of somebody: it describes what the API
        // objected to, not what they should change.
        controller.enqueue(
          frame("error", {
            error: explainAgentFailure(Number(err?.status) || 0, err, {
              model: ABSENTEEISM_MODEL,
              modelEnvVar: "WELO_AGENT_MODEL",
            }),
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Vercel and proxies must not buffer an SSE response.
      "x-accel-buffering": "no",
    },
  });
}
