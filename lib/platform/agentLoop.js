/*
  The tool-use loop.

  Call the model, run whatever tools it asks for, hand the results back, and
  repeat until it answers. Three things here are easy to get subtly wrong, and
  each is a test:

  1. **The assistant turn goes back whole.** With adaptive thinking on, the
     model's thinking blocks have to be returned exactly as they came, beside
     its tool calls. Rebuilding the turn from the tool calls alone drops them
     and the next request is refused.

  2. **Every tool call is answered.** A turn can ask for several tools. Each
     gets a tool_result, including the ones that fail, or the next request is
     malformed.

  3. **The loop ends.** A model that keeps asking for tools stops after
     `maxTurns` rounds. The last round is sent with tools switched off, so the
     reader still gets an answer built from what was gathered, and the response
     says the limit was hit rather than passing off a forced answer as a
     natural one.

  The client is passed in, so a test can script the model's replies and the
  route can pass the real SDK client. Nothing here reads the environment.
*/

import { runTool, toolSpecs } from "./agentTools.js";

export const DEFAULT_MAX_TURNS = 6;

/*
  Appended to the role's system prompt when tools are on. The role prompts are
  shared with the Python service, which has no tools, so they say "reason only
  over the data supplied". This says where that data now comes from.
*/
export const TOOL_GUIDANCE = [
  "TOOLS",
  "You can call tools to read the platform's figures. Prefer a tool over the request's DATA block when both cover the same figure, because tools read the server's copy.",
  "Tools return cohort-level data only. If a tool refuses or withholds a result, say so plainly and do not guess the missing figure.",
  "Only the draft_recommendation tool proposes an action, and it only drafts: a person approves or rejects every draft. Never describe a draft as approved, booked or done.",
  "Only the draft_outcome tool proposes a measured outcome, and it only drafts: a person checks and records every outcome. Never describe an outcome as recorded.",
].join("\n");

function sumUsage(total, usage = {}) {
  for (const key of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
    if (usage[key] != null) total[key] = (total[key] || 0) + usage[key];
  }
  return total;
}

function textOf(message) {
  return (message?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function runAgentLoop({
  client,
  model,
  system,
  userContent,
  tools = [],
  toolContext = {},
  maxTurns = DEFAULT_MAX_TURNS,
  maxTokens = 16000,
  thinking = { type: "adaptive" },
}) {
  const trace = [];
  // Drafts collected by the drafting tool during this run. Never persisted
  // here: the caller decides what to do with them.
  const ctx = { ...toolContext, trace, drafts: [], outcomes: [] };
  const messages = [{ role: "user", content: userContent }];
  const usage = {};
  const specs = toolSpecs(tools);
  let message = null;
  let turns = 0;
  let exhausted = false;

  const base = {
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    thinking,
  };

  for (;;) {
    turns += 1;
    const lastRound = turns > maxTurns;
    const request = { ...base, messages };
    if (specs.length) {
      request.tools = specs;
      // On the last round the tools stay declared, because earlier turns refer
      // to them, but the model may not call one.
      if (lastRound) request.tool_choice = { type: "none" };
    }

    message = await client.messages.create(request);
    sumUsage(usage, message.usage);

    if (message.stop_reason !== "tool_use" || lastRound) {
      exhausted = lastRound;
      break;
    }

    const uses = (message.content || []).filter((b) => b.type === "tool_use");
    const results = uses.map((use) => runTool(tools, use, ctx));
    messages.push({ role: "assistant", content: message.content });
    messages.push({ role: "user", content: results });
  }

  return {
    text: textOf(message),
    stop_reason: message?.stop_reason || null,
    truncated: message?.stop_reason === "max_tokens",
    turns,
    exhausted,
    trace,
    drafts: ctx.drafts || [],
    outcomes: ctx.outcomes || [],
    usage,
  };
}
