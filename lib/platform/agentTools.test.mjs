import { test } from "node:test";
import assert from "node:assert/strict";

import { defineTool, runTool, screenOutput, toolSpecs, validateInput } from "./agentTools.js";
import { PERMISSIONS, ROLES } from "./roles.js";

/*
  The rules every agent tool runs under. The failure each test guards against
  is a tool that looks fine in a demo and leaks in use: a role reaching a tool
  it should not, model-written input reaching a run function unchecked, or a
  figure below cohort level reaching the model.
*/

const session = (role) => ({ email: `${role}@example.com`, role, permissions: ROLES[role].permissions });

const echo = defineTool({
  name: "echo",
  description: "Returns what it is given.",
  permission: PERMISSIONS.USE_AGENTS,
  input_schema: {
    type: "object",
    properties: { value: { type: "string" }, size: { type: "string", enum: ["small", "large"] } },
    required: ["value"],
    additionalProperties: false,
  },
  run: (input) => ({ echoed: input.value }),
});

const leaky = (payload) =>
  defineTool({ name: "leaky", description: "x", permission: PERMISSIONS.USE_AGENTS, run: () => payload });

const call = (name, input, id = "t1") => ({ type: "tool_use", id, name, input });

// --- Definition -----------------------------------------------------------

test("a tool must name the permission it needs", () => {
  assert.throws(() => defineTool({ name: "x_tool", description: "x", run: () => ({}) }), /permission/);
});

test("a tool name must be snake_case, the shape the API accepts", () => {
  assert.throws(() => defineTool({ name: "Read Data", permission: "p", run: () => ({}) }), /snake_case/);
});

test("the spec sent to the model carries no run function or permission", () => {
  const [spec] = toolSpecs([echo]);
  assert.deepEqual(Object.keys(spec).sort(), ["description", "input_schema", "name"]);
});

// --- Running --------------------------------------------------------------

test("a permitted call runs and is traced", () => {
  const trace = [];
  const r = runTool([echo], call("echo", { value: "hi" }), { session: session("analyst"), trace });
  assert.equal(r.type, "tool_result");
  assert.equal(r.tool_use_id, "t1");
  assert.equal(r.is_error, undefined);
  assert.deepEqual(JSON.parse(r.content), { echoed: "hi" });
  assert.equal(trace.length, 1);
  assert.equal(trace[0].ok, true);
});

test("an unknown tool gets an error result, not an exception", () => {
  const trace = [];
  const r = runTool([echo], call("nope", {}), { session: session("analyst"), trace });
  assert.equal(r.is_error, true);
  assert.equal(trace[0].error, "unknown tool");
});

test("a role without the tool's permission is refused in words the model can relay", () => {
  // Viewer may not use the agents at all.
  const r = runTool([echo], call("echo", { value: "hi" }), { session: session("viewer") });
  assert.equal(r.is_error, true);
  assert.match(r.content, /may not use echo/);
});

test("no session means no tool", () => {
  const r = runTool([echo], call("echo", { value: "hi" }), {});
  assert.equal(r.is_error, true);
});

test("model-written input is validated before the tool runs", () => {
  let ran = false;
  const watched = defineTool({ ...echo, run: () => ((ran = true), {}) });
  const ctx = { session: session("analyst") };
  for (const input of [{}, { value: 3 }, { value: "x", extra: 1 }, { value: "x", size: "huge" }, null]) {
    const r = runTool([watched], call("echo", input), ctx);
    assert.equal(r.is_error, true, `accepted ${JSON.stringify(input)}`);
  }
  assert.equal(ran, false, "the tool ran on input it should have refused");
});

test("a tool that throws becomes an error result the model can read", () => {
  const broken = defineTool({ name: "broken", description: "x", permission: PERMISSIONS.USE_AGENTS, run: () => { throw new Error("target is suppressed"); } });
  const r = runTool([broken], call("broken", {}), { session: session("analyst") });
  assert.equal(r.is_error, true);
  assert.match(r.content, /target is suppressed/);
});

// --- Output screening -----------------------------------------------------

test("a person's identifier anywhere in the output withholds the whole result", () => {
  const trace = [];
  const r = runTool([leaky({ cohorts: [{ label: "A", rows: [{ employee_id: 10432 }] }] })], call("leaky", {}), {
    session: session("analyst"),
    trace,
  });
  assert.equal(r.is_error, true);
  assert.ok(!r.content.includes("10432"), "the identifier reached the model in the refusal");
  assert.equal(trace[0].error, "output withheld");
});

test("a suppressed cohort carrying a figure withholds the result", () => {
  const problems = screenOutput({ cohorts: [{ label: "Tiny", suppressed: true, count: 3 }] });
  assert.ok(problems.length > 0);
  const measure = screenOutput({ cohorts: [{ label: "Tiny", suppressed: true, count: null, cost_exposure_rand: 9000 }] });
  assert.ok(measure.some((p) => p.includes("cost_exposure_rand")));
});

test("a suppressed cohort with no figures passes, so the model can say one was withheld", () => {
  assert.deepEqual(screenOutput({ cohorts: [{ key: "Tiny", label: "Tiny", count: null, suppressed: true, suppression: "primary" }] }), []);
});

test("validateInput names every problem, not just the first", () => {
  const errors = validateInput(echo.input_schema, { size: "huge", extra: true });
  assert.equal(errors.length, 3);
});
