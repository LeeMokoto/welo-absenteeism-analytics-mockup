/*
  The shared body of a non-streaming agent route.

  Two modules now serve the same agent roles over different figures: sick leave
  over entitlement and condition mix, absence over predicted days, fatigue and
  cover. Everything that differs between them is grounding, prompts and a
  model. Everything that must not differ is in here.

  That split is the point. The parts a second copy would quietly stop doing are
  the permission check, the no-key branch and the redaction on the error path,
  and this codebase has already produced two bugs of exactly that shape: a CI
  glob that silently stopped collecting half the tests, and a leak check that
  ran against a dead port and passed on an empty body. A second hand-written
  agent route would be the same bet a third time.

  So a route supplies four things and nothing else: its prompts, its fallback,
  its model, and the environment variable that names the model. The sequence
  below is identical for both, and a change to it reaches both.
*/

import Anthropic from "@anthropic-ai/sdk";
import { requirePermission } from "@/lib/platform/session";
import { PERMISSIONS } from "@/lib/platform/roles";
import { agentFailureLog, explainAgentFailure } from "@/lib/platform/agentErrors";
import { runAgentLoop, TOOL_GUIDANCE } from "@/lib/platform/agentLoop";

/*
  The ceiling on a single answer.

  It was 1200, which truncated answers mid-sentence. Adaptive thinking is on
  for these calls, and thinking tokens are generated before any visible text
  and count against this same budget, so a model that thought for a thousand
  tokens had two hundred left to answer in. On screen that reads as a layout
  bug: the text simply stops. It is not one, and the response box was measured
  growing past seven thousand pixels without clipping.

  16000 is the documented default for a non-streaming request: high enough
  that an answer is never cut, low enough to stay inside the SDK's HTTP
  timeout. It is a ceiling, not a target, and costs nothing when unused: a
  request is billed for the tokens actually generated.
*/
export const MAX_TOKENS = 16000;

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/*
  Build a POST handler.

  `agents`      the agent ids this route serves, so an unknown one is refused
  `aliases`     optional former names mapped to current ids
                here rather than reaching a prompt lookup that returns undefined
  `promptFor`   (agent) => system prompt string, server-side only
  `fallback`    { answer, refusal, chipsFor } for the no-key path
  `model`       the model id this route calls
  `modelEnvVar` the variable that overrides it, named in a failure message so
                an operator is told which of the two to change
  `scope`       the label on the server log line, so the logs can be grepped
                per module
  `toolsFor`    optional (agent) => tools, or a promise of them. An agent with tools runs the
                tool-use loop in lib/platform/agentLoop.js; one without answers
                in one shot, exactly as before
  `toolContext` optional ({ agent, session, body }) => (a promise of) the server-side data the
                tools read. Never built from the request body
*/
export function createAgentHandler({ agents, aliases = {}, promptFor, fallback, model, modelEnvVar, scope, toolsFor, toolContext }) {
  return async function POST(request) {
    // The solution design puts the role check in the API, so a hidden menu
    // item is never the only control. A caller whose session may not use the
    // agents is refused here even though the panel is not rendered for them.
    const { session, allowed } = await requirePermission(PERMISSIONS.USE_AGENTS);
    if (!allowed) {
      return json({ error: "This role may not use the agents." }, 403);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body was not valid JSON." }, 400);
    }

    const { question, context } = body || {};
    // A former agent name resolves to its successor, so a caller built against
    // it keeps working; anything else unknown is refused below.
    const agent = aliases[body?.agent] || body?.agent;

    if (!agent || !agents.includes(agent)) {
      return json({ error: "Unknown agent." }, 400);
    }
    if (typeof question !== "string" || !question.trim()) {
      return json({ error: "A question is required." }, 400);
    }
    if (context == null || typeof context !== "object") {
      return json({ error: "Grounding context is required." }, 400);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    /*
      No key, so no model. The panel answers its own suggested questions from
      the grounding the screen already assembled, by arithmetic, and labels
      every answer as not a model. A question outside that set is refused by
      name rather than answered generically: a canned paragraph returned for
      any input is what would make a buyer think the product is cleverer than
      it is, and then feel misled.
    */
    if (!apiKey) {
      const text = fallback.answer(agent, question, context);
      if (text) return json({ text, model: null, source: "summary" });
      return json({
        text: fallback.refusal(agent, fallback.chipsFor(agent)),
        model: null,
        source: "summary",
        answered: false,
      });
    }

    const system = promptFor(agent);
    if (!system) {
      return json({ error: "This agent is not configured." }, 500);
    }

    const userContent =
      "CONTEXT (the sample figures currently on screen, reason only over this):\n" +
      "```json\n" +
      JSON.stringify(context, null, 2) +
      "\n```\n\nQUESTION:\n" +
      question.trim();

    const tools = toolsFor ? await toolsFor(agent) : [];

    try {
      const client = new Anthropic({ apiKey });

      /*
        With tools, the agent looks figures up and may draft a priced action.
        The response says which tools ran and returns any drafts, so the panel
        can show them and an approver can see what a draft was built from.
        Drafts are not stored here: the store decides that, after its own
        checks.
      */
      if (tools.length) {
        const run = await runAgentLoop({
          client,
          model,
          system: system + "\n\n" + TOOL_GUIDANCE,
          userContent,
          tools,
          toolContext: { ...(toolContext ? await toolContext({ agent, session, body }) : {}), agent, session },
          maxTokens: MAX_TOKENS,
        });
        return json({
          text: run.text,
          model,
          source: "model",
          truncated: run.truncated,
          stop_reason: run.stop_reason,
          turns: run.turns,
          tool_limit_reached: run.exhausted,
          tool_calls: run.trace.map(({ tool, input, ok, error, ms }) => ({ tool, input, ok, error, ms })),
          drafts: run.drafts,
          outcomes: run.outcomes,
          usage: run.usage,
        });
      }

      const message = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        // The system prompt is stable across every call on a route and only
        // the grounding varies, so it caches well. Adaptive thinking matches
        // what the Python service does, so the two deployments answer the same
        // question with the same reasoning effort.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        thinking: { type: "adaptive" },
        messages: [{ role: "user", content: userContent }],
      });

      const text = (message.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      const usage = message.usage || {};

      /*
        A cut answer says so. If the ceiling above is ever reached again, the
        reader is told the answer is incomplete instead of being left to
        wonder why a sentence stops, which is how this was first reported.
      */
      const truncated = message.stop_reason === "max_tokens";

      return json({
        text,
        model,
        source: "model",
        truncated,
        stop_reason: message.stop_reason || null,
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
      // Logged server side with anything key-shaped redacted: an SDK error can
      // echo request context back.
      console.error(...agentFailureLog(scope, { agent, model, err }));
      return json(
        {
          error: explainAgentFailure(status, err, { model, modelEnvVar }),
          model,
        },
        status >= 400 && status < 600 ? status : 502,
      );
    }
  };
}
