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
import {
  systemPromptFor,
  userContent,
  MAX_TOKENS,
  ABSENTEEISM_MODEL,
} from "../../../_prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function frame(event, payload) {
  const head = event ? `event: ${event}\n` : "";
  return encoder.encode(`${head}data: ${JSON.stringify(payload)}\n\n`);
}

// Never echo anything key-shaped back to the browser or into a log line.
function redact(s) {
  return String(s || "").replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]");
}

export async function POST(request, { params }) {
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
          system,
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
        console.error(
          "[absenteeism agent] stream failed",
          JSON.stringify({
            agent,
            model: ABSENTEEISM_MODEL,
            status: Number(err?.status) || null,
            type: err?.error?.error?.type || err?.name || null,
            message: redact(err?.error?.error?.message || err?.message || String(err)),
          })
        );
        controller.enqueue(
          frame("error", {
            error: redact(err?.error?.error?.message || err?.message || "The agent request failed."),
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
