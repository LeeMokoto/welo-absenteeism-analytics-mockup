import { test } from "node:test";
import assert from "node:assert/strict";

import { runAgentLoop, TOOL_GUIDANCE } from "./agentLoop.js";
import { defineTool } from "./agentTools.js";
import { PERMISSIONS, ROLES } from "./roles.js";

/*
  The loop, against a scripted model. The client records every request, so the
  tests can check what was sent back as well as what came out.
*/

function scripted(replies) {
  const requests = [];
  let i = 0;
  return {
    requests,
    messages: {
      create: async (req) => {
        requests.push(structuredClone(req));
        const reply = typeof replies === "function" ? replies(i) : replies[Math.min(i, replies.length - 1)];
        i += 1;
        return reply;
      },
    },
  };
}

const session = { email: "analyst@example.com", role: "analyst", permissions: ROLES.analyst.permissions };

const lookup = defineTool({
  name: "lookup",
  description: "x",
  permission: PERMISSIONS.USE_AGENTS,
  input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false },
  run: ({ key }) => ({ key, value: 42 }),
});

const answer = (text, usage = { input_tokens: 10, output_tokens: 5 }) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
  usage,
});

const base = { model: "m", system: "role prompt", userContent: "question", tools: [lookup], toolContext: { session } };

test("a model that answers straight away takes one turn", async () => {
  const client = scripted([answer("done")]);
  const r = await runAgentLoop({ ...base, client });
  assert.equal(r.text, "done");
  assert.equal(r.turns, 1);
  assert.equal(r.exhausted, false);
  assert.equal(client.requests[0].tools[0].name, "lookup");
  assert.equal(client.requests[0].tool_choice, undefined);
});

test("the assistant turn goes back whole, thinking included, and every call is answered", async () => {
  const toolTurn = {
    stop_reason: "tool_use",
    content: [
      { type: "thinking", thinking: "I need the figure.", signature: "sig-abc" },
      { type: "tool_use", id: "u1", name: "lookup", input: { key: "a" } },
      { type: "tool_use", id: "u2", name: "lookup", input: {} },
    ],
    usage: { input_tokens: 20, output_tokens: 8 },
  };
  const client = scripted([toolTurn, answer("The figure is 42.")]);
  const r = await runAgentLoop({ ...base, client });

  const second = client.requests[1].messages;
  assert.deepEqual(second[1], { role: "assistant", content: toolTurn.content });
  const results = second[2].content;
  assert.deepEqual(results.map((x) => x.tool_use_id), ["u1", "u2"]);
  assert.equal(results[0].is_error, undefined);
  assert.equal(results[1].is_error, true, "invalid input should come back as an error result");

  assert.equal(r.text, "The figure is 42.");
  assert.equal(r.turns, 2);
  assert.deepEqual(r.trace.map((t) => t.ok), [true, false]);
  assert.equal(r.usage.input_tokens, 30);
  assert.equal(r.usage.output_tokens, 13);
});

test("a model that keeps calling tools is stopped, and the last round may not call one", async () => {
  const forever = () => ({
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: `u${Math.random()}`, name: "lookup", input: { key: "a" } }],
    usage: {},
  });
  const client = scripted((i) => (i < 2 ? forever() : answer("Best answer from what I gathered.")));
  const r = await runAgentLoop({ ...base, client, maxTurns: 2 });

  assert.equal(client.requests.length, 3);
  assert.deepEqual(client.requests[2].tool_choice, { type: "none" });
  assert.ok(client.requests[2].tools, "tools stay declared so earlier turns still make sense");
  assert.equal(r.exhausted, true);
  assert.equal(r.text, "Best answer from what I gathered.");
});

test("a cut answer is reported as cut", async () => {
  const client = scripted([{ stop_reason: "max_tokens", content: [{ type: "text", text: "The cover gap lands" }], usage: {} }]);
  const r = await runAgentLoop({ ...base, client });
  assert.equal(r.truncated, true);
});

test("drafts made by a tool during the run are returned to the caller", async () => {
  const drafter = defineTool({
    name: "drafter",
    description: "x",
    permission: PERMISSIONS.USE_AGENTS,
    run: (_input, ctx) => (ctx.drafts.push({ id: "d1" }), { id: "d1" }),
  });
  const client = scripted([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "u1", name: "drafter", input: {} }], usage: {} },
    answer("Drafted."),
  ]);
  const r = await runAgentLoop({ ...base, tools: [drafter], client });
  assert.deepEqual(r.drafts, [{ id: "d1" }]);
});

test("the tool guidance says drafts are never approved, booked or done", () => {
  assert.match(TOOL_GUIDANCE, /Never describe a draft as approved, booked or done/);
});
