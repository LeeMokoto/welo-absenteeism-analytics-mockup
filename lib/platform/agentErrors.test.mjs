import { test } from "node:test";
import assert from "node:assert/strict";

import { agentFailureLog, explainAgentFailure, redact } from "./agentErrors.js";

/*
  The agents are the part of this product that is hardest to explain and most
  expensive to have down, so a failure has to name its remedy. These tests are
  about that: every status an operator will actually hit says what to change,
  no message carries a credential, and the three routes log the same shape so
  the logs can be grepped.
*/

const err = (message, type = "invalid_request_error") => ({
  error: { error: { message, type } },
});

// --- Each status names its own fix -----------------------------------------

test("a rejected key says it is the key", () => {
  const m = explainAgentFailure(401, err("invalid x-api-key"), { model: "claude-opus-5-5" });
  assert.match(m, /key was rejected/);
});

test("an unavailable model names the model and the variable to change", () => {
  const m = explainAgentFailure(404, err("not found"), {
    model: "claude-opus-5-5",
    modelEnvVar: "WELO_AGENT_MODEL",
  });
  assert.match(m, /claude-opus-5-5/);
  assert.match(m, /WELO_AGENT_MODEL/);
});

test("the variable named is the one that route actually reads", () => {
  // Two deployments read two different variables, and telling somebody to set
  // the model without saying which variable is half an instruction.
  const sick = explainAgentFailure(404, err("x"), {
    model: "claude-sonnet-5-5",
    modelEnvVar: "SICK_LEAVE_AGENT_MODEL",
  });
  assert.match(sick, /SICK_LEAVE_AGENT_MODEL/);
  assert.ok(!sick.includes("WELO_AGENT_MODEL"));
});

test("an exhausted balance is distinguished from a bad model, because both arrive as 400", () => {
  const credit = explainAgentFailure(400, err("Your credit balance is too low"), { model: "m" });
  assert.match(credit, /insufficient credit/);
  assert.match(credit, /spend cap/);

  const model = explainAgentFailure(400, err("model: unknown model id"), { model: "m" });
  assert.match(model, /was rejected/);
  assert.ok(!/credit/i.test(model));
});

test("a rejected thinking configuration says what this code requests", () => {
  /*
    Its own branch because budget_tokens was how extended thinking used to be
    requested and is rejected on the current family. A half-finished model
    upgrade lands exactly here, and "invalid request" would send somebody
    looking at the grounding instead.
  */
  const m = explainAgentFailure(400, err("thinking.budget_tokens is not supported"), {
    model: "claude-opus-5-5",
  });
  assert.match(m, /adaptive thinking/);
  assert.match(m, /budget_tokens/);
});

test("rate limiting mentions the two causes that look identical", () => {
  const m = explainAgentFailure(429, err("rate limit"), { model: "m" });
  assert.match(m, /Rate limited/);
  assert.match(m, /out of credit/);
});

test("an upstream outage says to retry rather than to change anything", () => {
  for (const status of [500, 502, 503, 529]) {
    const m = explainAgentFailure(status, err("overloaded"), { model: "m" });
    assert.match(m, /temporarily unavailable/, `status ${status}`);
  }
});

test("an unrecognised status still points somewhere", () => {
  const m = explainAgentFailure(0, { message: "socket hang up" }, { model: "m" });
  assert.match(m, /did not complete/);
  assert.match(m, /server logs/);
});

// --- Nothing carries a credential ------------------------------------------

test("a key-shaped string is redacted wherever it appears", () => {
  const key = "sk-ant-api03-REALLOOKINGKEY_abc123-xyz";
  assert.equal(redact(`using ${key} failed`), "using sk-ant-[REDACTED] failed");
  assert.ok(!redact(key).includes("REALLOOKINGKEY"));
});

test("no explanation echoes a key the upstream error happened to include", () => {
  const key = "sk-ant-api03-LEAKED_abc123";
  for (const status of [400, 404]) {
    const m = explainAgentFailure(status, err(`bad request with ${key}`), { model: "m" });
    assert.ok(!m.includes("LEAKED"), `status ${status} leaked the key: ${m}`);
  }
});

test("the log line carries no credential and keeps one shape", () => {
  const key = "sk-ant-api03-LEAKED_abc123";
  const [scope, payload] = agentFailureLog("sick-leave agent", {
    agent: "analyst",
    model: "claude-sonnet-5-5",
    err: { status: 401, ...err(`rejected ${key}`, "authentication_error") },
  });
  assert.match(scope, /^\[sick-leave agent\]/);
  const parsed = JSON.parse(payload);
  assert.deepEqual(Object.keys(parsed).sort(), ["agent", "message", "model", "status", "type"]);
  assert.equal(parsed.status, 401);
  assert.equal(parsed.model, "claude-sonnet-5-5");
  assert.ok(!payload.includes("LEAKED"), payload);
});

test("a thrown Error with no SDK shape still logs usefully", () => {
  const [, payload] = agentFailureLog("control-centre playbook", {
    agent: "playbook",
    model: "claude-opus-5-5",
    err: new TypeError("fetch failed"),
  });
  const parsed = JSON.parse(payload);
  assert.equal(parsed.type, "TypeError");
  assert.match(parsed.message, /fetch failed/);
  assert.equal(parsed.status, null);
});
