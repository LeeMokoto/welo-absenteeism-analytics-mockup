/*
  Targeting rules and the actions store.

  Run with: node --test modules/control-centre/targeting.test.mjs

  These are the control centre's governance spine. The register screen refuses
  a target at the point of save rather than warning about it, and these are the
  refusals.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TARGET_DIMENSIONS,
  NEVER_TARGETABLE,
  canSaveIntervention,
  targetHeadcount,
  targetableDimensions,
  untargetableReason,
  validateTarget,
} from "./targeting.js";

import {
  INDIVIDUAL_FIELDS,
  carriesIndividual,
  createIntervention,
  seeded,
  stripIndividualFields,
} from "./store.js";

const DIMENSIONS = [
  { key: "cohort_load", label: "Operational load", protected: false, min_cohort: 5 },
  { key: "cohort_fatigue", label: "Fatigue / burnout band", protected: false, min_cohort: 5 },
  { key: "cohort_age", label: "Age band", protected: true, min_cohort: 10 },
  { key: "cohort_tenure", label: "Tenure band", protected: false, min_cohort: 5 },
  { key: "cohort_lifestyle", label: "Lifestyle risk", protected: false, min_cohort: 5 },
];

const COHORTS = {
  cohort_load: [
    { key: "High-intensity ops", label: "High-intensity ops", count: 2030 },
    { key: "Light duty", label: "Light duty", count: 2523 },
    { key: "Tiny crew", label: "Tiny crew", suppressed: true, suppressed_below: 5 },
  ],
  cohort_fatigue: [{ key: "Critical", label: "Critical", count: 231 }],
  cohort_age: [{ key: "50+", label: "50+", count: 900 }],
  cohort_tenure: [{ key: "New (<2y)", label: "New (<2y)", count: 400 }],
  cohort_lifestyle: [{ key: "Smoker", label: "Smoker", count: 600 }],
};

const ctx = { dimensions: DIMENSIONS, cohorts: COHORTS, suppressionThreshold: 5 };

// --- Protected attributes ---------------------------------------------------

test("age is reportable and not targetable", () => {
  const age = DIMENSIONS.find((d) => d.key === "cohort_age");
  // The explicit entry wins over the generic protected flag, because it names
  // the ground rather than the category.
  assert.equal(untargetableReason(age), "age is a protected attribute");
  assert.ok(!targetableDimensions(DIMENSIONS).some((d) => d.key === "cohort_age"));
});

test("a target naming an age band is refused", () => {
  const r = validateTarget([{ dimension: "cohort_age", cohort: "50+" }], ctx);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /Age band cannot be targeted: age is a protected attribute/);
});

test("the never-targetable list covers the protected grounds and condition data", () => {
  for (const key of ["cohort_age", "cohort_gender", "cohort_race", "cohort_disability", "cohort_condition"]) {
    assert.ok(NEVER_TARGETABLE[key], `${key} must never be targetable`);
  }
});

test("a manifest cannot widen the never-targetable list", () => {
  // Even asked for explicitly, age stays out.
  const allowed = ["cohort_load", "cohort_age"];
  assert.ok(!targetableDimensions(DIMENSIONS, allowed).some((d) => d.key === "cohort_age"));
});

// --- Lifestyle --------------------------------------------------------------

test("lifestyle risk is not targetable by default, and says why", () => {
  const lifestyle = DIMENSIONS.find((d) => d.key === "cohort_lifestyle");
  assert.equal(untargetableReason(lifestyle), "not in this tenant's targeting list");
});

test("a tenant that asks for lifestyle can have it", () => {
  const allowed = ["cohort_load", "cohort_lifestyle"];
  assert.ok(targetableDimensions(DIMENSIONS, allowed).some((d) => d.key === "cohort_lifestyle"));
});

// --- Narrowing --------------------------------------------------------------

test("two dimensions are allowed", () => {
  const r = validateTarget(
    [
      { dimension: "cohort_load", cohort: "High-intensity ops" },
      { dimension: "cohort_fatigue", cohort: "Critical" },
    ],
    ctx
  );
  assert.equal(r.ok, true, r.errors.join("; "));
});

test("three dimensions are refused", () => {
  const r = validateTarget(
    [
      { dimension: "cohort_load", cohort: "High-intensity ops" },
      { dimension: "cohort_fatigue", cohort: "Critical" },
      { dimension: "cohort_tenure", cohort: "New (<2y)" },
    ],
    ctx
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), new RegExp(`at most ${MAX_TARGET_DIMENSIONS} dimensions`));
});

test("an empty target is refused", () => {
  assert.equal(validateTarget([], ctx).ok, false);
});

test("the same dimension twice is refused", () => {
  const r = validateTarget(
    [
      { dimension: "cohort_load", cohort: "High-intensity ops" },
      { dimension: "cohort_load", cohort: "Light duty" },
    ],
    ctx
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /selected twice/);
});

// --- Small cohorts ----------------------------------------------------------

test("a suppressed cohort cannot be targeted", () => {
  const r = validateTarget([{ dimension: "cohort_load", cohort: "Tiny crew" }], ctx);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /suppressed, so it is too small to target/);
});

test("a cohort that does not exist is refused", () => {
  const r = validateTarget([{ dimension: "cohort_load", cohort: "Nowhere" }], ctx);
  assert.equal(r.ok, false);
});

test("an intervention below the threshold cannot be saved", () => {
  const small = {
    ...ctx,
    cohorts: { ...COHORTS, cohort_load: [{ key: "Small", label: "Small", count: 3 }] },
  };
  const r = canSaveIntervention([{ dimension: "cohort_load", cohort: "Small" }], small);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /under the threshold/);
});

// --- Headcount --------------------------------------------------------------

test("one dimension gives a headcount", () => {
  assert.equal(targetHeadcount([{ dimension: "cohort_load", cohort: "High-intensity ops" }], COHORTS), 2030);
});

test("two dimensions give no headcount rather than an invented one", () => {
  const picks = [
    { dimension: "cohort_load", cohort: "High-intensity ops" },
    { dimension: "cohort_fatigue", cohort: "Critical" },
  ];
  assert.equal(targetHeadcount(picks, COHORTS), null);
  const r = canSaveIntervention(picks, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.headcount, null);
  assert.equal(r.needsConfirmation, true, "an unknown intersection must be flagged, not estimated");
});

// --- The store --------------------------------------------------------------

test("no seeded record carries an employee key", () => {
  for (const record of seeded()) {
    assert.equal(carriesIndividual(record), false, `${record.id} carries an individual field`);
    assert.ok(Array.isArray(record.target) && record.target.length, `${record.id} has no cohort target`);
  }
});

test("individual fields are stripped rather than stored", () => {
  const dirty = { title: "x", target: [], employee_key: "abc", name: "A Person", email: "a@b.c" };
  const clean = stripIndividualFields(dirty);
  for (const f of INDIVIDUAL_FIELDS) assert.ok(!(f in clean), `${f} survived`);
  assert.equal(clean.title, "x");
});

test("creating a record strips an individual field a caller passes by accident", () => {
  const { record } = createIntervention({
    title: "Test",
    owner: "Someone",
    target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
    employee_key: "should-not-survive",
  });
  assert.equal(carriesIndividual(record), false);
  assert.equal(record.status, "Proposed");
  assert.equal(record.outcome, null);
});

test("a seeded outcome is framed as observed, never as caused", () => {
  const measured = seeded().filter((r) => r.outcome?.measured);
  assert.ok(measured.length, "there should be a measured example to look at");
  for (const r of measured) {
    assert.match(r.outcome.note, /[Nn]ot proof/);
    assert.ok(r.outcome.comparators.length, "an outcome needs comparators");
  }
});

// --- Alert rules -------------------------------------------------------------

import {
  COMPARISONS,
  MEASURES,
  describeRule,
  evaluateAll,
  evaluateRule,
  validateRule,
} from "./alerts.js";
import { seededRules } from "./store.js";

const SUPPRESSED_COHORTS = {
  ...COHORTS,
  cohort_load: [
    { key: "High-intensity ops", label: "High-intensity ops", count: 2030, high_or_critical_share: 0.2148, mean_fatigue: 68.4, absent_days_per_head_annual: 18.7 },
    { key: "Standard ops", label: "Standard ops", suppressed: true, suppression: "primary", suppressed_below: 5 },
    { key: "Light duty", label: "Light duty", suppressed: true, suppression: "complementary", suppressed_below: 5 },
  ],
  cohort_age: [
    { key: "50+", label: "50+", count: 900, high_or_critical_share: 0.3, mean_fatigue: 70, absent_days_per_head_annual: 20 },
  ],
};

const actx = { ...ctx, cohorts: SUPPRESSED_COHORTS };

test("an alert rule on a protected attribute is refused", () => {
  const r = validateRule(
    { name: "Age watch", measure: "mean_fatigue", comparison: "above", threshold: 60, scope: { dimension: "cohort_age" } },
    actx
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /age is a protected attribute/);
});

test("a rule on a targetable dimension is accepted", () => {
  const r = validateRule(
    { name: "Risk watch", measure: "high_or_critical_share", comparison: "above", threshold: 0.2, scope: { dimension: "cohort_load" } },
    actx
  );
  assert.equal(r.ok, true, r.errors.join("; "));
});

test("a rule needs a name, a measure, a comparison and a number", () => {
  const r = validateRule({ scope: { dimension: "cohort_load" } }, actx);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4, r.errors.join("; "));
});

test("no alert names a suppressed cohort", () => {
  const rule = { name: "x", measure: "high_or_critical_share", comparison: "above", threshold: 0.0, scope: { dimension: "cohort_load" } };
  const out = evaluateRule(rule, { cohorts: SUPPRESSED_COHORTS, suppressionThreshold: 5 });
  const named = [...out.firing, ...out.quiet].map((x) => x.cohort);
  assert.ok(!named.includes("Standard ops"), "a suppressed cohort was named in an alert");
  assert.ok(!named.includes("Light duty"), "a withheld cohort was named in an alert");
  assert.equal(out.firing.length, 1);
  assert.equal(out.firing[0].cohort, "High-intensity ops");
});

test("skipped cohorts are counted and explained, not silently dropped", () => {
  const rule = { name: "x", measure: "mean_fatigue", comparison: "above", threshold: 1, scope: { dimension: "cohort_load" } };
  const out = evaluateRule(rule, { cohorts: SUPPRESSED_COHORTS, suppressionThreshold: 5 });
  assert.equal(out.skipped.length, 2);
  assert.match(out.skipped.map((s) => s.reason).join(" "), /under the reporting minimum/);
  assert.match(out.skipped.map((s) => s.reason).join(" "), /withheld to protect/);
});

test("a cohort under the threshold is skipped even when it carries figures", () => {
  const cohorts = { cohort_load: [{ key: "Tiny", label: "Tiny", count: 3, mean_fatigue: 90 }] };
  const rule = { name: "x", measure: "mean_fatigue", comparison: "above", threshold: 1, scope: { dimension: "cohort_load" } };
  const out = evaluateRule(rule, { cohorts, suppressionThreshold: 5 });
  assert.equal(out.firing.length, 0);
  assert.equal(out.skipped.length, 1);
});

test("measures are rates and averages, never counts", () => {
  for (const m of MEASURES) {
    assert.ok(!/count$/.test(m.key), `${m.key} is a count: a rule on it fires because a cohort is large`);
  }
});

test("a rule reads as a sentence", () => {
  const rule = seededRules()[0];
  const text = describeRule(rule, DIMENSIONS);
  assert.match(text, /Alert when share at high or critical risk rises above 20\.0% for any cohort of Operational load\./);
});

test("every seeded rule is valid and targets a targetable dimension", () => {
  for (const rule of seededRules()) {
    const r = validateRule(rule, actx);
    assert.equal(r.ok, true, `${rule.id}: ${r.errors.join("; ")}`);
  }
});

test("a disabled rule is not evaluated", () => {
  const rules = [{ ...seededRules()[0], enabled: false }];
  assert.equal(evaluateAll(rules, { cohorts: SUPPRESSED_COHORTS }).length, 0);
});

test("comparisons do what they say", () => {
  const above = COMPARISONS.find((c) => c.key === "above");
  const below = COMPARISONS.find((c) => c.key === "below");
  assert.equal(above.test(5, 4), true);
  assert.equal(above.test(4, 4), false);
  assert.equal(below.test(3, 4), true);
  assert.equal(below.test(4, 4), false);
});

test("an empty threshold is missing, not zero", () => {
  // Number("") is 0, so a naive finite check accepts a blank field and the
  // rule then fires on every cohort it meets.
  const base = { name: "x", measure: "mean_fatigue", comparison: "above", scope: { dimension: "cohort_load" } };
  for (const threshold of ["", null, undefined]) {
    const r = validateRule({ ...base, threshold }, actx);
    assert.equal(r.ok, false, `threshold ${JSON.stringify(threshold)} was accepted`);
    assert.match(r.errors.join(" "), /numeric threshold/);
  }
  assert.equal(validateRule({ ...base, threshold: 0 }, actx).ok, true, "an explicit zero is a real threshold");
})
