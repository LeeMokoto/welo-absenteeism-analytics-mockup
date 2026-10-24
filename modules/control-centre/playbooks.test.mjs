import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HORIZONS,
  MAX_STEPS,
  PLAYBOOK_STATUSES,
  REFUSED_STEP_LANGUAGE,
  STEP_OWNERS,
  approvalBlockers,
  canApprovePlaybook,
  individualReferenceIn,
  outcomeStatement,
  parseDraft,
  playbookTarget,
  refusedLanguageIn,
  validatePlaybook,
  validateStep,
} from "./playbooks.js";

/*
  These tests are written as the things that must not get through, because that
  is what the module is for. A playbook is the first artefact in the product
  that says what will be done to a group of people, and the failure modes are
  specific: a step that names somebody, a step that is a disciplinary action
  wearing care language, a plan that measures nothing, and a drafter approving
  their own work.
*/

const GOOD_STEP = {
  action: "Offer fatigue screening to the whole cohort through the on-site clinic, opt in.",
  owner: "Occupational health",
  horizon: "short",
  measure: "mean_fatigue",
};

const INTERVENTION = {
  id: "icv-002",
  target: [{ dimension: "cohort_fatigue", cohort: "Critical" }],
};

const playbook = (over = {}) => ({
  id: "pb-test",
  intervention_id: "icv-002",
  title: "Fatigue screening plan",
  status: "Drafted",
  drafted_by: "sipho.dlamini@example.com",
  steps: [GOOD_STEP],
  ...over,
});

// --- The happy path, so the refusals below mean something -------------------

test("a cohort-level care plan with a reportable measure is accepted", () => {
  const { ok, errors } = validatePlaybook(playbook(), { intervention: INTERVENTION });
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});

// --- Rule 1: no target of its own -------------------------------------------

test("a playbook carrying its own target is refused even when the target is valid", () => {
  const { ok, errors } = validatePlaybook(
    playbook({ target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }] }),
    { intervention: INTERVENTION },
  );
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("carries no target of its own")));
});

test("a playbook with no intervention has no target and is refused", () => {
  const { ok, errors } = validatePlaybook(playbook(), {});
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("belongs to an intervention")));
});

test("the target comes from the intervention, never the playbook", () => {
  assert.deepEqual(playbookTarget(playbook(), [INTERVENTION]), INTERVENTION.target);
  // An orphan resolves to no target rather than to everyone.
  assert.deepEqual(playbookTarget(playbook({ intervention_id: "nope" }), [INTERVENTION]), []);
});

// --- Rule 2: no step names a person -----------------------------------------

test("an employee key in a step is refused", () => {
  const errors = validateStep({ ...GOOD_STEP, action: "Book a review with EMP-10432 this week." });
  assert.ok(errors.some((e) => e.includes("an employee key")));
});

test("an email address in a step is refused", () => {
  const errors = validateStep({
    ...GOOD_STEP,
    action: "Send the screening invitation to thandi.mokoena@example.com for action.",
  });
  assert.ok(errors.some((e) => e.includes("an email address")));
});

test("an identity number in a step is refused", () => {
  const errors = validateStep({
    ...GOOD_STEP,
    action: "Confirm the record against 8001015009087 before the clinic visit.",
  });
  assert.ok(errors.some((e) => e.includes("identity number")));
});

test("naming a per-person field is refused even with no value attached", () => {
  assert.ok(individualReferenceIn("Export the employee_id column for the clinic").length > 0);
  assert.ok(individualReferenceIn("Pull the employee number for each case").length > 0);
});

test("a cohort-level action is not mistaken for an individual one", () => {
  assert.deepEqual(individualReferenceIn(GOOD_STEP.action), []);
  assert.deepEqual(
    individualReferenceIn("Cap consecutive shifts at eight across the cohort."),
    [],
  );
});

// --- Rule 3: no disciplinary or attendance-management step -------------------

test("a disciplinary step is refused however reasonably it is worded", () => {
  for (const action of [
    "Where absence continues, begin a disciplinary process in line with policy.",
    "Issue a written warning after the third occurrence in a quarter.",
    "Refer repeat cases to a capability process with HR support.",
    "Prepare for a CCMA hearing if the pattern persists.",
  ]) {
    const errors = validateStep({ ...GOOD_STEP, action });
    assert.ok(
      errors.some((e) => e.includes("a disciplinary process")),
      `not refused: ${action}`,
    );
  }
});

test("treating absence as suspect is refused", () => {
  for (const action of [
    "Review the absence pattern of each cohort member for sick leave abuse.",
    "Assess whether the absence was genuine or not before offering support.",
    "Flag any suspicious pattern to the operations lead for follow up.",
  ]) {
    const errors = validateStep({ ...GOOD_STEP, action });
    assert.ok(errors.length > 0, `not refused: ${action}`);
  }
});

test("surveillance of a person is refused", () => {
  const errors = validateStep({
    ...GOOD_STEP,
    action: "Arrange a home visit to verify the certificate where spells repeat.",
  });
  assert.ok(errors.length > 0);
});

test("an employment consequence attached to a health measure is refused", () => {
  const errors = validateStep({
    ...GOOD_STEP,
    action: "Withhold pay for days beyond entitlement and remove the attendance bonus.",
  });
  assert.ok(errors.length > 0);
});

test("the refusal says which line was crossed, not just that one was", () => {
  const hits = refusedLanguageIn("Start a disciplinary process and arrange surveillance.");
  const reasons = new Set(hits.map((h) => h.reason));
  assert.ok(reasons.size >= 2, "two different lines were crossed and both should be named");
  for (const h of hits) assert.ok(h.reason.length > 5);
});

test("a supportive step using none of the refused language passes", () => {
  assert.deepEqual(refusedLanguageIn(GOOD_STEP.action), []);
  assert.deepEqual(
    refusedLanguageIn("Offer a voluntary return-to-work conversation focused on support."),
    [],
  );
});

// --- Rule 4: a plan has to be closeable out ---------------------------------

test("a playbook whose steps measure nothing is refused", () => {
  const { ok, errors } = validatePlaybook(
    playbook({ steps: [{ ...GOOD_STEP, measure: null }] }),
    { intervention: INTERVENTION },
  );
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("cannot be closed out")));
});

test("a measure the platform does not report is refused", () => {
  const errors = validateStep({ ...GOOD_STEP, measure: "morale" });
  assert.ok(errors.some((e) => e.includes("not a measure this platform reports")));
});

test("a count is not a measure a playbook can watch", () => {
  // Counts are absent from MEASURES on purpose: a count moves because a cohort
  // is large, not because it is unwell.
  const errors = validateStep({ ...GOOD_STEP, measure: "high_or_critical_count" });
  assert.ok(errors.some((e) => e.includes("not a measure this platform reports")));
});

// --- Step hygiene -----------------------------------------------------------

test("a step owner must be a function, not a named person", () => {
  const errors = validateStep({ ...GOOD_STEP, owner: "Sipho Dlamini" });
  assert.ok(errors.some((e) => e.includes("a function owns a step")));

  // And the allowed list holds no personal names itself. Two capitalised words
  // is what a person's name looks like, so nothing in the list may match it.
  for (const owner of STEP_OWNERS) {
    assert.ok(
      !/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(owner),
      `"${owner}" reads as a person's name rather than a function`,
    );
  }
  assert.ok(STEP_OWNERS.length >= 4, "too few owners to be a usable list");
});

test("a step needs an action long enough to follow, and a horizon", () => {
  assert.ok(validateStep({ ...GOOD_STEP, action: "Do it" }).some((e) => e.includes("too short")));
  assert.ok(validateStep({ ...GOOD_STEP, action: "" }).some((e) => e.includes("needs an action")));
  assert.ok(validateStep({ ...GOOD_STEP, horizon: "yesterday" }).some((e) => e.includes("horizon")));
});

test("a playbook longer than the step cap is refused", () => {
  const steps = Array.from({ length: MAX_STEPS + 1 }, () => ({ ...GOOD_STEP }));
  const { ok, errors } = validatePlaybook(playbook({ steps }), { intervention: INTERVENTION });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes(`at most ${MAX_STEPS} steps`)));
});

test("every problem is reported, not just the first", () => {
  const { errors } = validatePlaybook(
    playbook({
      title: "",
      steps: [{ action: "Begin a disciplinary process for EMP-10432.", owner: "Sipho", horizon: "x" }],
    }),
    { intervention: INTERVENTION },
  );
  assert.ok(errors.length >= 5, `expected several problems, got ${errors.length}: ${errors}`);
});

// --- Approval is separate from drafting -------------------------------------

test("holding the permission is not enough: the drafter cannot approve their own plan", () => {
  const pb = playbook();
  const drafter = { email: "sipho.dlamini@example.com", role: "analyst" };
  assert.equal(canApprovePlaybook(pb, drafter, { hasApprovePermission: true }), false);
  assert.ok(
    approvalBlockers(pb, drafter, { hasApprovePermission: true }).some((b) =>
      b.includes("cannot approve it"),
    ),
  );
});

test("someone else holding the permission can approve it", () => {
  const approver = { email: "naledi.khumalo@example.com", role: "approver" };
  assert.equal(canApprovePlaybook(playbook(), approver, { hasApprovePermission: true }), true);
});

test("without the permission nobody approves, whoever they are", () => {
  const other = { email: "thandi.mokoena@example.com", role: "viewer" };
  assert.equal(canApprovePlaybook(playbook(), other, { hasApprovePermission: false }), false);
  assert.equal(canApprovePlaybook(playbook(), null, { hasApprovePermission: true }), false);
});

test("a decided or superseded playbook cannot be approved again", () => {
  const approver = { email: "naledi.khumalo@example.com", role: "approver" };
  for (const status of ["Approved", "Rejected", "Superseded"]) {
    assert.equal(
      canApprovePlaybook(playbook({ status }), approver, { hasApprovePermission: true }),
      false,
      `${status} was approvable`,
    );
  }
});

// --- Outcomes stay observational --------------------------------------------

test("an outcome is an observed difference and says so", () => {
  const o = outcomeStatement({
    measured: true,
    baseline_days_per_head: 18.7,
    observed_days_per_head: 17.9,
    comparators: ["Standard ops", "Light duty"],
  });
  assert.equal(o.direction, "lower");
  assert.equal(o.size, "0.8");
  assert.ok(o.caveat.includes("not evidence that the playbook caused it"));
  // No causal verb anywhere in what the interface would render.
  for (const word of ["caused", "because of", "thanks to", "achieved", "delivered"]) {
    assert.ok(!o.text.toLowerCase().includes(word), `outcome text implies causation: ${word}`);
  }
});

test("an unmeasured playbook produces no outcome statement at all", () => {
  assert.equal(outcomeStatement(null), null);
  assert.equal(outcomeStatement({ measured: false }), null);
});

test("a worse outcome is reported as plainly as a better one", () => {
  const o = outcomeStatement({
    measured: true,
    baseline_days_per_head: 10,
    observed_days_per_head: 12.5,
    comparators: ["Standard ops"],
  });
  assert.equal(o.direction, "higher");
  assert.equal(o.size, "2.5");
});

// --- The lists themselves ---------------------------------------------------

test("the refused-language screen is substantial and every group says why", () => {
  assert.ok(REFUSED_STEP_LANGUAGE.length >= 4);
  for (const group of REFUSED_STEP_LANGUAGE) {
    assert.ok(group.reason && group.reason.length > 8, `group has no usable reason: ${group.reason}`);
    assert.ok(group.terms.length >= 5, `group "${group.reason}" has too few terms`);
    for (const t of group.terms) {
      assert.equal(t, t.toLowerCase(), `terms are matched lowercased: ${t}`);
    }
  }
});

test("statuses and horizons are the ones the screens rely on", () => {
  assert.deepEqual(PLAYBOOK_STATUSES, ["Drafted", "In review", "Approved", "Rejected", "Superseded"]);
  assert.deepEqual(HORIZONS.map((h) => h.key), ["immediate", "short", "sustained"]);
});

// --- Parsing an agent draft -------------------------------------------------

test("a well-formed draft parses into steps and a reason", () => {
  const { steps, why } = parseDraft(
    [
      "STEP | Offer fatigue screening through the on-site clinic, opt in | Occupational health | short | mean_fatigue",
      "STEP | Cap consecutive shifts at eight across the cohort | Shift scheduling | immediate | absent_days_per_head_annual",
      "",
      "WHY: the cohort carries 21.7 absent days per head against 12.3 for the next band.",
    ].join("\n"),
  );
  assert.equal(steps.length, 2);
  assert.equal(steps[0].owner, "Occupational health");
  assert.equal(steps[0].horizon, "short");
  assert.equal(steps[0].measure, "mean_fatigue");
  assert.equal(steps[1].horizon, "immediate");
  assert.ok(why.includes("21.7"));
});

test("the word none becomes no measure rather than a measure called none", () => {
  const { steps } = parseDraft(
    "STEP | Brief the shift leads on the rest-day floor | Operations lead | immediate | none",
  );
  assert.equal(steps[0].measure, null);
});

test("a missing field arrives missing rather than invented, and validation catches it", () => {
  const { steps } = parseDraft("STEP | Offer screening to the cohort through the clinic | | short |");
  assert.equal(steps[0].owner, "");
  assert.equal(steps[0].measure, null);
  const errors = validateStep(steps[0]);
  assert.ok(errors.some((e) => e.includes("the owner must be one of")));
});

test("prose the model wrote around the steps is dropped", () => {
  const { steps, why } = parseDraft(
    [
      "Here is a plan for this cohort:",
      "STEP | Offer fatigue screening through the clinic, opt in | Occupational health | short | mean_fatigue",
      "Let me know if you would like this expanded.",
    ].join("\n"),
  );
  assert.equal(steps.length, 1);
  assert.equal(why, "");
});

test("parsing is forgiving about case and spacing, strict about fields", () => {
  const { steps } = parseDraft(
    "step|Offer fatigue screening through the clinic, opt in|Occupational health|SHORT|mean_fatigue",
  );
  assert.equal(steps.length, 1);
  assert.equal(steps[0].horizon, "short");
  assert.deepEqual(validateStep(steps[0]), []);
});

test("an empty or junk draft yields no steps rather than a broken one", () => {
  assert.deepEqual(parseDraft("").steps, []);
  assert.deepEqual(parseDraft("I cannot help with that.").steps, []);
  assert.deepEqual(parseDraft(null).steps, []);
});

/*
  The case this whole module exists for: an agent draft that looks like a
  reasonable operational plan and contains a disciplinary step. It must parse,
  so the refusal can name the step, and then fail validation.
*/
test("a draft that slips in a disciplinary step parses and is then refused", () => {
  const { steps } = parseDraft(
    [
      "STEP | Offer fatigue screening through the on-site clinic, opt in | Occupational health | short | mean_fatigue",
      "STEP | Where absence continues after screening, begin a disciplinary process | HR business partner | short | none",
    ].join("\n"),
  );
  assert.equal(steps.length, 2, "the step must parse so the refusal can point at it");

  const { ok, errors } = validatePlaybook(
    { id: "pb", intervention_id: "icv-002", title: "Plan", steps, drafted_by: "x@example.com" },
    { intervention: INTERVENTION },
  );
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith("Step 2") && e.includes("a disciplinary process")));
  // And the good step is not blamed for the bad one.
  assert.ok(!errors.some((e) => e.startsWith("Step 1")));
});

test("the store limitation is still expressible, even though the demo no longer needs it", () => {
  const approver = { email: "naledi.khumalo@example.com", role: "approver" };
  const shared = playbook({ source: "seeded" });
  assert.equal(
    canApprovePlaybook(shared, approver, { hasApprovePermission: true, storeCanDecide: false }),
    false,
  );
  assert.ok(
    approvalBlockers(shared, approver, { hasApprovePermission: true, storeCanDecide: false }).some(
      (b) => b.includes("shared"),
    ),
  );
  // And the default stays permissive, so the domain rule is what decides when
  // the store is not the limitation.
  assert.equal(canApprovePlaybook(playbook(), approver, { hasApprovePermission: true }), true);
});

/*
  The individual-reference screen must not refuse a step for saying the right
  thing. Three entries in INDIVIDUAL_FIELDS are ordinary English words, and
  matching them turned "applied to the roster rather than to individuals" into
  a refusal: a step that names nobody, refused for the word for nobody. Found
  because the fallback drafter's own template tripped it.

  A screen that refuses the correct sentence teaches people to write a worse
  one, so the real identifiers are caught by pattern and the bare words are not.
*/
test("saying a step is not about individuals is not a reference to an individual", () => {
  for (const line of [
    "Cap consecutive shifts across the cohort, applied to the roster rather than to individuals.",
    "Send an email to the cohort explaining what was agreed and why.",
    "Report the change back by name of site, not by name of person.",
  ]) {
    assert.deepEqual(individualReferenceIn(line), [], `wrongly refused: ${line}`);
    assert.deepEqual(validateStep({ ...GOOD_STEP, action: line }), [], `wrongly refused: ${line}`);
  }
});

test("an actual identifier is still caught, which is what the screen is for", () => {
  // The words were dropped from the field-name check; the patterns that catch
  // the real thing are untouched.
  assert.ok(individualReferenceIn("Email thandi.mokoena@example.com the roster").length > 0);
  assert.ok(individualReferenceIn("Check EMP-10432 before the shift").length > 0);
  assert.ok(individualReferenceIn("Verify against 8001015009087").length > 0);
  // And the field-shaped references remain refused.
  assert.ok(individualReferenceIn("Export the employee_id column").length > 0);
  assert.ok(individualReferenceIn("Pull the employee number for each case").length > 0);
  assert.ok(individualReferenceIn("Attach the id_number to the referral").length > 0);
});
