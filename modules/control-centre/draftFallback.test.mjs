import { test } from "node:test";
import assert from "node:assert/strict";

import { FALLBACK_NOTICE, fallbackDraft, templateIntegrity } from "./draftFallback.js";
import { refusedLanguageIn, individualReferenceIn, validatePlaybook } from "./playbooks.js";

/*
  The fallback drafter exists so the approval flow can be demonstrated without
  an agent key. Two risks come with it, and these tests are about those rather
  than about the prose.

  The first is that a template quietly becomes exempt from the rules, which
  would make the rules look like theatre. So every template is run through the
  real validator.

  The second, and worse, is that a template draft passes as a model draft. That
  overclaims the product to a buyer, so the label is asserted at every layer it
  travels through.
*/

const cohorts = {
  cohort_load: [
    {
      key: "High-intensity ops",
      count: 2030,
      absent_days_per_head_annual: 18.7,
      mean_fatigue: 64.2,
      high_or_critical_share: 0.2147,
    },
    { key: "Standard ops", count: 3000, absent_days_per_head_annual: 11.2, mean_fatigue: 54.1 },
    { key: "Light duty", count: 700, absent_days_per_head_annual: 7.4, mean_fatigue: 48.0 },
  ],
  cohort_fatigue: [
    { key: "Critical", count: 1153, absent_days_per_head_annual: 21.7, mean_fatigue: 71.9 },
    { key: "High", count: 2836, absent_days_per_head_annual: 13.1, mean_fatigue: 58.0 },
  ],
  cohort_tenure: [
    { key: "New (<2y)", count: 486, absent_days_per_head_annual: 11.9, mean_fatigue: 57.7 },
    { key: "Veteran (10y+)", count: 1462, absent_days_per_head_annual: 12.1, mean_fatigue: 58.3 },
  ],
};

const intervention = (dimension, cohort) => ({
  id: "icv-x",
  title: "Test intervention",
  created: "2026-04-02",
  target: [{ dimension, cohort }],
});

// --- The rules apply to it ---------------------------------------------------

test("every dimension's template is a playbook the validator accepts", () => {
  for (const [dimension, rows] of Object.entries(cohorts)) {
    const target = rows[0].key;
    const draft = fallbackDraft(intervention(dimension, target), cohorts);
    const { ok, errors } = validatePlaybook(
      {
        intervention_id: "icv-x",
        title: "Playbook",
        steps: draft.steps,
        why: draft.why,
        drafted_by: "sipho.dlamini@example.com",
      },
      { intervention: intervention(dimension, target) },
    );
    assert.deepEqual(errors, [], `${dimension} template was refused`);
    assert.equal(ok, true);
  }
});

test("an unknown dimension still produces a valid plan rather than a blank one", () => {
  const draft = fallbackDraft(intervention("cohort_invented", "Something"), cohorts);
  assert.ok(draft.steps.length > 0, "a blank draft tells the user nothing about why it is blank");
  const { ok } = validatePlaybook(
    { intervention_id: "icv-x", title: "P", steps: draft.steps, drafted_by: "a@example.com" },
    { intervention: intervention("cohort_invented", "Something") },
  );
  assert.equal(ok, true);
});

test("no template step contains refused language or names a person", () => {
  for (const [dimension, rows] of Object.entries(cohorts)) {
    const draft = fallbackDraft(intervention(dimension, rows[0].key), cohorts);
    for (const step of draft.steps) {
      assert.deepEqual(
        refusedLanguageIn(step.action),
        [],
        `${dimension}: "${step.action}" contains refused language`,
      );
      assert.deepEqual(individualReferenceIn(step.action), [], `${dimension}: step names a person`);
    }
    assert.deepEqual(refusedLanguageIn(draft.why), [], `${dimension}: the why contains refused language`);
  }
});

test("the templates themselves are internally sound", () => {
  // Owners, horizons, and measures the platform actually reports. Asserted
  // rather than assumed, because a template is edited as prose and a measure
  // typo would only surface as a refused draft in front of a buyer.
  assert.deepEqual(templateIntegrity(), []);
});

// --- It cannot pass as a model draft ----------------------------------------

test("the draft labels itself as a template, not as an agent", () => {
  const draft = fallbackDraft(intervention("cohort_load", "High-intensity ops"), cohorts);
  assert.equal(draft.drafted_with, "template");
  assert.notEqual(draft.drafted_with, "agent");
});

test("the notice says plainly that no model was called", () => {
  assert.match(FALLBACK_NOTICE, /No language model was called/);
  assert.match(FALLBACK_NOTICE, /same rules as a model draft/);
  assert.match(FALLBACK_NOTICE, /filed as template rather than agent/);
});

test("the why says it was assembled rather than written for this cohort", () => {
  const draft = fallbackDraft(intervention("cohort_load", "High-intensity ops"), cohorts);
  assert.match(draft.why, /assembled from the cohort's reported figures/);
  assert.match(draft.why, /not written for this cohort specifically/);
});

// --- The figures are the cohort's own ---------------------------------------

test("the why quotes the targeted cohort's real numbers and the comparison", () => {
  const draft = fallbackDraft(intervention("cohort_load", "High-intensity ops"), cohorts);
  assert.ok(draft.why.includes("2030 people"), draft.why);
  assert.ok(draft.why.includes("18.7 absent days per head"), draft.why);
  // The rest of the dimension: (11.2 + 7.4) / 2 = 9.3
  assert.ok(draft.why.includes("against 9.3"), draft.why);
  assert.ok(draft.why.includes("mean fatigue 64.2"), draft.why);
  assert.ok(draft.why.includes("21.5 percent at high or critical risk"), draft.why);
});

test("a suppressed cohort yields a plan that admits it has no figures", () => {
  const withheld = {
    cohort_load: [{ key: "Relief pool", suppressed: true }],
  };
  const draft = fallbackDraft(intervention("cohort_load", "Relief pool"), withheld);
  assert.match(draft.why, /carries no published figures/);
  // And it does not invent a comparison out of nothing.
  assert.ok(!/against \d/.test(draft.why), draft.why);
});

test("a dimension with only the targeted cohort reported makes no comparison", () => {
  const alone = { cohort_fatigue: [{ key: "Critical", count: 1153, absent_days_per_head_annual: 21.7 }] };
  const draft = fallbackDraft(intervention("cohort_fatigue", "Critical"), alone);
  assert.ok(draft.why.includes("1153 people"));
  assert.ok(!draft.why.includes("against"), draft.why);
});

// --- Deterministic -----------------------------------------------------------

test("the same intervention and feed produce the same plan", () => {
  const a = fallbackDraft(intervention("cohort_load", "High-intensity ops"), cohorts);
  const b = fallbackDraft(intervention("cohort_load", "High-intensity ops"), cohorts);
  assert.deepEqual(a, b);
});

test("the plan differs by dimension, because the lever differs", () => {
  const load = fallbackDraft(intervention("cohort_load", "High-intensity ops"), cohorts);
  const fatigue = fallbackDraft(intervention("cohort_fatigue", "Critical"), cohorts);
  assert.notDeepEqual(load.steps, fatigue.steps);
  // Rostering is scheduling's problem; screening is occupational health's.
  assert.ok(load.steps.some((s) => s.owner === "Shift scheduling"));
  assert.ok(fatigue.steps.some((s) => s.owner === "Occupational health"));
});

test("mutating a returned step does not poison the template", () => {
  const first = fallbackDraft(intervention("cohort_load", "High-intensity ops"), cohorts);
  first.steps[0].action = "Begin a disciplinary process.";
  const second = fallbackDraft(intervention("cohort_load", "High-intensity ops"), cohorts);
  assert.ok(!second.steps[0].action.includes("disciplinary"));
});
