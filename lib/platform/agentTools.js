/*
  Agent tools: what an agent may read, and the one thing it may propose.

  Until now every agent answered in one shot from a grounding object the
  browser assembled. That is enough to explain a screen and not enough to act:
  an agent that is going to recommend a roster change or a standby booking has
  to look things up, price them, and put the proposal somewhere a person can
  approve it. Tools are how it does that, and this file is the set of rules
  every tool runs under, whichever agent calls it.

  Five rules, each enforced here rather than in a prompt:

  1. **A tool reads server-side data, never the request body.** The grounding
     the panels send is assembled in the browser, so a caller can put anything
     in it. A tool reads the module data on the server, so what the model is
     told came from the platform.

  2. **A tool checks the caller's role.** Each tool names the permission it
     needs. A role that may use the agents but not draft actions gets a refusal
     from the drafting tool, in words the model can relay, not a draft that
     silently goes nowhere.

  3. **Input is validated before the tool runs.** The model writes tool input,
     and model-written input is untrusted input. Unknown fields, missing fields
     and values outside an enum are refused.

  4. **Output is screened before the model sees it.** Nothing that names a
     person, and no figure for a suppressed cohort, leaves a tool. A tool that
     produces one fails closed with an error result, because a figure the model
     has seen is a figure it can repeat.

  5. **Every call is traced.** Tool, input, whether it ran and how long it
     took. The trace travels with anything the agent drafts, so an approver can
     see what the recommendation was built from.

  Everything here is pure and synchronous apart from the clock, so the same
  call gives the same answer in the route, the screen and a test.
*/

import { can } from "./roles.js";

/*
  Field names that make a value about a person. Matched as keys anywhere in a
  tool's output, at any depth. Kept here rather than imported from the control
  centre store so the platform layer does not depend on a module.
*/
export const PERSON_KEYS = [
  "employee_key",
  "employee_id",
  "employee_number",
  "id_number",
  "first_name",
  "surname",
  "email",
  "individuals",
];

// Measures that must never appear on a suppressed row.
const SUPPRESSION_SAFE_KEYS = new Set([
  "key",
  "label",
  "suppressed",
  "suppressed_below",
  "suppression",
  "count",
]);

export function defineTool({ name, description, input_schema, permission, run }) {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(name || "")) {
    throw new Error(`Tool name "${name}" must be snake_case.`);
  }
  if (typeof run !== "function") throw new Error(`Tool ${name} has no run function.`);
  if (!permission) throw new Error(`Tool ${name} must name the permission it needs.`);
  return Object.freeze({
    name,
    description,
    input_schema: input_schema || { type: "object", properties: {}, additionalProperties: false },
    permission,
    run,
  });
}

// The tools in the shape the Messages API takes. Nothing server-only leaks.
export function toolSpecs(tools) {
  return tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

/*
  Validate model-written input against the tool's schema.

  Deliberately small: object input, named properties, required fields, string
  and number types, enums, and no fields the schema does not name. It is not a
  JSON Schema implementation and does not pretend to be one; a tool that needs
  more checks them in its own run function.
*/
export function validateInput(schema, input) {
  const errors = [];
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return ["input must be an object"];
  }
  const props = schema?.properties || {};
  for (const key of schema?.required || []) {
    if (input[key] === undefined) errors.push(`${key} is required`);
  }
  for (const [key, value] of Object.entries(input)) {
    const spec = props[key];
    if (!spec) {
      errors.push(`${key} is not a field this tool takes`);
      continue;
    }
    if (spec.type === "string" && typeof value !== "string") errors.push(`${key} must be text`);
    if (spec.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      errors.push(`${key} must be a number`);
    }
    if (spec.type === "array" && !Array.isArray(value)) errors.push(`${key} must be a list`);
    if (spec.type === "object" && (value == null || typeof value !== "object" || Array.isArray(value))) {
      errors.push(`${key} must be an object`);
    }
    if (spec.enum && !spec.enum.includes(value)) {
      errors.push(`${key} must be one of: ${spec.enum.join(", ")}`);
    }
    if (typeof spec.minimum === "number" && typeof value === "number" && value < spec.minimum) {
      errors.push(`${key} must be at least ${spec.minimum}`);
    }
  }
  return errors;
}

/*
  Screen a tool's output. Returns the problems found; empty means it may go to
  the model.
*/
export function screenOutput(value) {
  const problems = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      if (v.suppressed === true) {
        for (const [k, x] of Object.entries(v)) {
          if (!SUPPRESSION_SAFE_KEYS.has(k) && x != null) {
            problems.push(`${path || "output"} is a suppressed cohort but carries ${k}`);
          }
        }
        if (v.count != null) problems.push(`${path || "output"} is a suppressed cohort but carries its count`);
      }
      for (const [k, x] of Object.entries(v)) {
        if (PERSON_KEYS.includes(k.toLowerCase())) {
          problems.push(`${path ? path + "." : ""}${k} would identify a person`);
          continue;
        }
        walk(x, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(value, "");
  return problems;
}

function errorResult(id, message) {
  return { type: "tool_result", tool_use_id: id, is_error: true, content: message };
}

/*
  Run one tool_use block. Always returns a tool_result, because every tool_use
  in an assistant turn must be answered, including the ones that fail.

  `ctx` carries the session and whatever server-side data the tools read. The
  trace entry is pushed onto ctx.trace when one is given.
*/
export function runTool(tools, use, ctx = {}) {
  const started = Date.now();
  const tool = tools.find((t) => t.name === use?.name);
  const entry = { tool: use?.name || null, input: use?.input ?? null, ok: false, error: null, ms: 0 };
  const finish = (result) => {
    entry.ms = Date.now() - started;
    if (Array.isArray(ctx.trace)) ctx.trace.push(entry);
    return result;
  };

  if (!tool) {
    entry.error = "unknown tool";
    return finish(errorResult(use?.id, `There is no tool called ${use?.name}.`));
  }
  if (!can(ctx.session, tool.permission)) {
    entry.error = "not permitted";
    return finish(
      errorResult(use.id, `The signed-in role may not use ${tool.name}. Tell the user this step needs a role that can.`),
    );
  }
  const invalid = validateInput(tool.input_schema, use.input);
  if (invalid.length) {
    entry.error = "invalid input";
    return finish(errorResult(use.id, `Input refused: ${invalid.join("; ")}.`));
  }

  let output;
  try {
    output = tool.run(use.input, ctx);
  } catch (err) {
    entry.error = "tool failed";
    return finish(errorResult(use.id, `The tool could not complete: ${String(err?.message || err)}`));
  }

  const problems = screenOutput(output);
  if (problems.length) {
    // Fail closed. The tool's output is not sent at all, not sent cleaned.
    entry.error = "output withheld";
    return finish(
      errorResult(use.id, "The tool's result was withheld because it would have shown data below cohort level."),
    );
  }

  entry.ok = true;
  return finish({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output) });
}
