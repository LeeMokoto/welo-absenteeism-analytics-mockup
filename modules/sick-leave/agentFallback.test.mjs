import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENTS, AGENT_IDS } from "./agentMeta.js";
import { NOT_A_MODEL, canAnswer, fallbackAnswer, refusal } from "./agentFallback.js";
import { refusedLanguageIn } from "../control-centre/playbooks.js";

/*
  The summary path answers the agent panels when no key is configured. Three
  risks, and these tests are those rather than the prose.

  It passes as a model. That overclaims the product, so the label is asserted on
  every answer and the refusal.

  It answers something it should not. The router matches the panel's own
  suggested questions, and anything else is declined by name. A canned paragraph
  returned for any input is what makes a demo feel like a trick.

  It echoes the question. This is the one that would actually be dangerous: an
  answer that repeated its input would let a typed question put disciplinary
  language, or a person's name, into the product's own output. Every answer is a
  template over the grounding and never includes the question, and that is
  asserted directly.
*/

const CONTEXT = {
  period: "Trailing 12 months",
  headline: {
    sickLeaveRatePct: 3.2,
    totalSickDays: 28826,
    indicativeCostRand: 125762228,
    coverCostRand: 66710228,
  },
  entitlementBurn: {
    bands: [{ band: "76 to 100%", count: 245 }, { band: "Exhausted", count: 251 }],
    projection: { in3Months: 216, in6Months: 183, in12Months: 422 },
  },
  conditionMixByChapter: [
    { chapter: "Injury and external causes (S and T)", shareDaysPct: 28.6 },
    { chapter: "Musculoskeletal (M)", shareDaysPct: 28.0 },
  ],
  concentrationMatrix: [
    {
      site: "North plant",
      cells: [
        { function: "Production and operations", headcount: 509, ratePct: 4.4 },
        { function: "Administration", headcount: 118, ratePct: 2.0 },
      ],
    },
  ],
  cohortSummary: [
    { site: "North plant", shiftPattern: "Continuous (4 on 4 off)", pctAbove75Entitlement: 19 },
  ],
  predictedSickLeaveRateBySite: [{ site: "North plant", predictedRatePct: 3.7 }],
  coverGapHeatmapNext28Days: [
    { site: "Main plant", shiftPattern: "Continuous (4 on 4 off)", days: [15, 15, 15] },
  ],
  totalCoverGapShifts: 1884,
  overtimeBackfillCostRandIndicative: 5934600,
  returnToWorkCaseload: 214,
  entitlementExhaustionForecastByCohort: [
    { site: "Main plant", shiftPattern: "Continuous (4 on 4 off)", in3Months: 32 },
  ],
  certificationCompliance: { overall: { ratePct: 80, missing: 791 } },
  model: { drivers: [{ label: "Musculoskeletal strain" }], riskTier: "High" },
  entitlement: { entitlementDays: 30, daysRemaining: 8, cycleStartDate: "2025-02-01" },
  absenceHistoryByChapter: [{ icd10Chapter: "Musculoskeletal (M)" }],
  shiftPattern: "Continuous (4 on 4 off)",
  site: "Main plant",
};

// --- Every suggested question is answered -----------------------------------

test("every agent answers every question its own panel offers", () => {
  for (const id of AGENT_IDS) {
    for (const chip of AGENTS[id].chips) {
      assert.equal(canAnswer(id, chip), true, `${id} cannot answer its own chip: ${chip}`);
      const text = fallbackAnswer(id, chip, CONTEXT);
      assert.ok(text, `${id} returned nothing for: ${chip}`);
      assert.ok(text.length > 200, `${id} answer to "${chip}" is too thin: ${text.length} chars`);
    }
  }
});

test("an answer quotes the grounding rather than inventing figures", () => {
  const text = fallbackAnswer("analyst", AGENTS.analyst.chips[0], CONTEXT);
  assert.ok(text.includes("3.2%"), text);
  assert.ok(text.includes("28 826"), text);
  assert.ok(text.includes("North plant"), text);
  assert.ok(text.includes("Injury and external causes"), text);
});

test("an empty grounding produces an answer that says unknown rather than a number", () => {
  for (const id of AGENT_IDS) {
    const text = fallbackAnswer(id, AGENTS[id].chips[0], {});
    assert.ok(text, `${id} returned nothing on an empty context`);
    // No NaN, and no fabricated figure.
    assert.ok(!/NaN/.test(text), `${id} rendered NaN on an empty context`);
  }
});

// --- It cannot pass as a model ----------------------------------------------

test("every answer opens by saying no language model was called", () => {
  for (const id of AGENT_IDS) {
    for (const chip of AGENTS[id].chips) {
      const text = fallbackAnswer(id, chip, CONTEXT);
      assert.ok(text.startsWith(NOT_A_MODEL), `${id} answer is unlabelled: ${text.slice(0, 80)}`);
    }
  }
  assert.match(NOT_A_MODEL, /not by a language model/);
  assert.match(NOT_A_MODEL, /no agent key configured/);
});

test("the refusal is labelled too, and names what can be asked", () => {
  const text = refusal("analyst", AGENTS.analyst.chips);
  assert.ok(text.startsWith(NOT_A_MODEL));
  for (const chip of AGENTS.analyst.chips) assert.ok(text.includes(chip), `missing: ${chip}`);
  assert.match(text, /Configure an agent key/);
});

// --- It answers only what it should -----------------------------------------

test("a question outside the suggested set is declined, not answered", () => {
  for (const q of [
    "Who should we performance manage",
    "Summarise the weather",
    "What is our headcount by race",
    "",
  ]) {
    assert.equal(canAnswer("analyst", q), false, `wrongly matched: ${q}`);
    assert.equal(fallbackAnswer("analyst", q, CONTEXT), null, `wrongly answered: ${q}`);
  }
});

test("an unknown agent answers nothing", () => {
  assert.equal(canAnswer("nope", AGENTS.analyst.chips[0]), false);
  assert.equal(fallbackAnswer("nope", AGENTS.analyst.chips[0], CONTEXT), null);
});

// --- The dangerous one: an answer never echoes its input --------------------

test("no answer contains any part of the question it was asked", () => {
  /*
    The property that matters. An answer that repeated its input would let a
    typed question put disciplinary language, or somebody's name, into the
    product's own output and then onto a screen that looks like the product
    said it. Every answer is a template over the grounding, so a question that
    matches the router still contributes none of its own words.
  */
  const loaded =
    "Which intervention should we use to discipline EMP-10432 and dismiss thandi.mokoena@example.com";
  // It matches the leverage pattern on the word "intervention".
  assert.equal(canAnswer("analyst", loaded), true, "this test is pointless unless it matches");

  const text = fallbackAnswer("analyst", loaded, CONTEXT);
  assert.ok(text);
  for (const fragment of ["discipline", "dismiss", "EMP-10432", "thandi.mokoena"]) {
    assert.ok(!text.includes(fragment), `the answer echoed "${fragment}"`);
  }
});

test("no proposed action contains language a playbook step would be refused for", () => {
  /*
    Scoped to the action bullets, which is how the playbook validator uses this
    screen: it runs over `step.action` and never over the surrounding prose. A
    disclaimer naming what the plan is not for ("nothing for a performance or
    disciplinary process") is good governance writing and would trip a
    whole-text check, which is a measure of the check's scope rather than of the
    text. Reuses the control centre's screen so the two cannot disagree about
    what is out of bounds in an action.
  */
  for (const id of AGENT_IDS) {
    for (const chip of AGENTS[id].chips) {
      const text = fallbackAnswer(id, chip, CONTEXT);
      const actions = text
        .split(/\r?\n/)
        .filter((line) => line.trim().startsWith("- "));
      for (const action of actions) {
        assert.deepEqual(
          refusedLanguageIn(action),
          [],
          `${id} answer to "${chip}" proposes: ${action}`,
        );
      }
    }
  }
});

test("the case plan does name what it is not for, which is the point of saying it", () => {
  // The inverse of the test above: the disclaimer has to name the things, or it
  // disclaims nothing. Asserted so a future tidy does not quietly remove it to
  // make a whole-text screen pass.
  const plan = fallbackAnswer("case", "Draft a support plan for this record", CONTEXT);
  assert.ok(refusedLanguageIn(plan).length > 0, "the disclaimer stopped naming anything");
  assert.match(plan, /performance or disciplinary process/);
});

// --- The clinical constraints hold without a model --------------------------

test("the case answers stay care and support, and say what they are not for", () => {
  const plan = fallbackAnswer("case", "Draft a support plan for this record", CONTEXT);
  assert.match(plan, /no assessment of whether absence was warranted/);
  assert.match(plan, /not used for employment decisions/);
  assert.match(plan, /Planning context for you, not a warning about them/);
  // Entitlement is framed for the clinician, never as a threat to the employee.
  assert.ok(!/warning to the employee|final warning/i.test(plan));
});

test("the case answers never present the model score as a diagnosis", () => {
  const steps = fallbackAnswer("case", "What occupational health steps fit the top drivers", CONTEXT);
  assert.match(steps, /modelled, not a diagnosis/);
});

test("a care pathway is offered rather than assigned", () => {
  const paths = fallbackAnswer("case", "Which medical aid pathways apply here", CONTEXT);
  assert.match(paths, /offered, not assigned/);
  assert.match(paths, /not reported back to the line/);
});

// --- Rand framing -----------------------------------------------------------

test("every Rand figure is labelled indicative somewhere in the answer", () => {
  for (const id of ["analyst", "coordinator"]) {
    for (const chip of AGENTS[id].chips) {
      const text = fallbackAnswer(id, chip, CONTEXT);
      if (/R\d|R\s?\d/.test(text)) {
        assert.ok(
          /indicative/i.test(text),
          `${id} answer to "${chip}" shows a Rand figure without saying it is indicative`,
        );
      }
    }
  }
});

test("no answer uses an em or en dash", () => {
  for (const id of AGENT_IDS) {
    for (const chip of AGENTS[id].chips) {
      const text = fallbackAnswer(id, chip, CONTEXT);
      assert.ok(!text.includes("\u2014") && !text.includes("\u2013"), `${id}: ${chip}`);
    }
  }
  assert.ok(!refusal("analyst", AGENTS.analyst.chips).includes("\u2014"));
});
