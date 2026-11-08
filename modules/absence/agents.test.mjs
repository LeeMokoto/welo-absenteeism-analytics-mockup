import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENTS, AGENT_IDS } from "./agentMeta.js";
import { buildAnalystContext, buildCoordinatorContext } from "./context.js";
import { canAnswer, fallbackAnswer, refusal, NOT_A_MODEL } from "./agentFallback.js";
import { portfolio } from "./data/portfolio.js";

/*
  The absence agents.

  Two things can go wrong here that would not show up on screen. An agent can
  be handed a figure the reader is not allowed to see, and then repeat it back
  in prose. And the no-key fallback can quietly become a generic answering
  machine, which is worse than no agent at all because a buyer cannot tell.

  These tests are mostly about those two.
*/

const analyst = () => buildAnalystContext(portfolio);
const coordinator = () => buildCoordinatorContext(portfolio);

// --- The grounding carries nothing the screen withholds ---------------------

const SUPPRESSED = { key: "Tiny crew", label: "Tiny crew", count: 3, suppressed: true };

test("a suppressed cohort never reaches the analyst grounding", () => {
  const feed = structuredClone(portfolio);
  feed.cohorts.cohort_load = [...feed.cohorts.cohort_load, SUPPRESSED];
  const ctx = buildAnalystContext(feed);

  const blob = JSON.stringify(ctx);
  assert.ok(!blob.includes("Tiny crew"), "a withheld cohort was sent to the agent");
  assert.ok(ctx.suppression.withheld_cohorts >= 1, "the agent was not told one was withheld");
});

test("a suppressed cohort never reaches the coordinator grounding", () => {
  const feed = structuredClone(portfolio);
  feed.hr_ops.by_cohort = [...feed.hr_ops.by_cohort, SUPPRESSED];
  const ctx = buildCoordinatorContext(feed);

  assert.ok(!JSON.stringify(ctx).includes("Tiny crew"));
  assert.equal(ctx.suppression.withheld_cohorts, 1);
});

test("the grounding carries no individual records, because the module has none", () => {
  for (const ctx of [analyst(), coordinator()]) {
    const blob = JSON.stringify(ctx).toLowerCase();
    for (const field of ["employee_id", "employeeid", "first_name", "surname", "id_number"]) {
      assert.ok(!blob.includes(field), `grounding carried ${field}`);
    }
  }
});

test("attendance measures are withheld from the coordinator on purpose", () => {
  /*
    Absence frequency and Bradford are on the operations screen, where the copy
    says they size a support caseload and are not used for attendance
    management. Stripped of that copy they read as a ranking of who is absent
    most often, and the obvious next question turns them into a list of people
    to speak to.
  */
  const ctx = coordinator();

  /*
    Checked over the data, not the whole payload. The payload also carries a
    note explaining that these measures are withheld, and that note names
    them, so a blanket search over the blob flags the very sentence that makes
    the refusal explicit. That is the third time in this codebase a guard has
    tripped on its own disclaimer, so it is scoped to the fields that carry
    figures and the disclaimer is asserted separately below.
  */
  const { frequency_measures, note, suppression, ...data } = ctx;
  const blob = JSON.stringify(data).toLowerCase();
  assert.ok(!blob.includes("bradford"), "a Bradford score reached the agent");
  assert.ok(!blob.includes("freq_trigger"), "a frequency trigger count reached the agent");

  // The inverse: the disclaimer still names what it disclaims, so trimming it
  // to make the search above pass would fail here.
  assert.match(frequency_measures, /withheld/i);
  assert.match(frequency_measures, /bradford/i);
  assert.match(frequency_measures, /punitiv/i);
});

test("every figure the agent gets is labelled modelled or indicative", () => {
  assert.match(analyst().note, /modelled|indicative/i);
  assert.match(coordinator().note, /modelled|indicative/i);
  // The saving in particular, which is the figure most likely to be quoted.
  assert.match(analyst().addressable_saving_basis, /projected|never measured/i);
});

// --- The fallback answers the suggested questions, and refuses the rest -----

test("every suggested question has a fallback answer", () => {
  for (const id of AGENT_IDS) {
    for (const chip of AGENTS[id].chips) {
      assert.ok(canAnswer(id, chip), `${id} cannot answer its own chip: "${chip}"`);
    }
  }
});

test("each fallback answer is built from the real grounding and names figures", () => {
  const ctx = { analyst: analyst(), coordinator: coordinator() };
  for (const id of AGENT_IDS) {
    for (const chip of AGENTS[id].chips) {
      const text = fallbackAnswer(id, chip, ctx[id]);
      assert.ok(text, `${id} / ${chip} produced nothing`);
      assert.ok(text.startsWith(NOT_A_MODEL), "an answer did not open by saying it is not a model");
      assert.ok(!/unknown/.test(text.replace(NOT_A_MODEL, "")), `${id} / ${chip} rendered "unknown": ${text.slice(0, 200)}`);
      assert.ok(text.length > 300, `${id} / ${chip} is too thin to be an answer`);
    }
  }
});

test("a question outside the set is refused, not answered", () => {
  const out = fallbackAnswer("analyst", "What is the weather in Johannesburg", analyst());
  assert.equal(out, null, "a generic question was answered");
  const r = refusal("analyst", AGENTS.analyst.chips);
  assert.match(r, /cannot answer a question outside/i);
  for (const chip of AGENTS.analyst.chips) assert.ok(r.includes(chip));
});

test("a disciplinary question is not answered by the fallback", () => {
  // The guardrail belongs to the product, not to the model, so it has to hold
  // on the path where there is no model.
  for (const q of [
    "Which employees should we discipline for absence",
    "Who are the worst attenders",
    "Is this absence genuine",
  ]) {
    assert.equal(fallbackAnswer("analyst", q, analyst()), null, `answered: ${q}`);
    assert.equal(fallbackAnswer("coordinator", q, coordinator()), null, `answered: ${q}`);
  }
});

test("no fallback answer names a person or an employee key", () => {
  const ctx = { analyst: analyst(), coordinator: coordinator() };
  for (const id of AGENT_IDS) {
    for (const chip of AGENTS[id].chips) {
      const text = (fallbackAnswer(id, chip, ctx[id]) || "").toLowerCase();
      assert.ok(!/\bemp-?\d|\bemployee \d|\bid number\b/.test(text), `${id} / ${chip} named an identifier`);
    }
  }
});

test("the fallback degrades to 'unknown' rather than inventing a figure", () => {
  // An empty grounding must not produce confident prose. It should produce
  // the shape with the figures missing, which reads as broken, which is
  // correct: a confident answer over no data is the failure worth preventing.
  const text = fallbackAnswer("analyst", AGENTS.analyst.chips[0], {});
  assert.ok(text.includes("unknown"), "an empty grounding produced no visible gap");
});

// --- The module contract matches what is actually mounted -------------------

test("the module declares the agents that exist, and not the one that does not", async () => {
  const { default: absenceModule } = await import("./module.js");
  assert.deepEqual([...absenceModule.agents].sort(), [...AGENT_IDS].sort());
  assert.ok(!absenceModule.agents.includes("case"), "the case agent is declared but has no case view here");
});

test("the guardrails record why there is no case assistant and what is withheld", async () => {
  const { default: absenceModule } = await import("./module.js");
  const rails = absenceModule.guardrails.join(" ");
  assert.match(rails, /no Case Assistant/i);
  assert.match(rails, /below the suppression threshold is stripped/i);
  assert.match(rails, /Bradford/i);
});
