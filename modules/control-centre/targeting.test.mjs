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
