import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBriefing, headline } from "./briefing.js";

/*
  A briefing is forwarded, pasted into an email and read by people who never
  saw the screen it came from. So the tests here are about what survives that
  journey: that the caveat travels inside it, that decisions lead, that a
  suppressed cohort stays suppressed, and that nothing in it is an individual.
*/

const dimensions = [
  { key: "cohort_load", label: "Operational load" },
  { key: "cohort_age", label: "Age band", protected: true, min_cohort: 10 },
];

const cohorts = {
  cohort_load: [
    { key: "High-intensity ops", label: "High-intensity ops", count: 2030, high_or_critical_share: 0.31, mean_fatigue: 64 },
    { key: "Standard ops", label: "Standard ops", count: 3000, high_or_critical_share: 0.08, mean_fatigue: 54 },
    { key: "Relief pool", label: "Relief pool", suppressed: true, suppressed_below: 5 },
  ],
};

const months = Array.from({ length: 12 }, (_, i) => {
  const m = String(((10 + i) % 12) + 1).padStart(2, "0");
  const y = 10 + i < 12 ? 2025 : 2026;
  return `${y}-${m}-01`;
});

const series = {
  periods: months,
  measure: "absent_days_per_head_annual",
  measure_source: "actual absence, not model prediction",
  membership: "frozen at the baseline period",
  series: {
    cohort_load: {
      label: "Operational load",
      cohorts: {
        "High-intensity ops": {
          label: "High-intensity ops",
          count: 2030,
          suppressed: false,
          periods: months.map((m, i) => ({
            period_start: m,
            count: 2030,
            absent_days_per_head_annual: i < 5 ? 20 : 18,
          })),
        },
        "Standard ops": {
          label: "Standard ops",
          count: 3000,
          suppressed: false,
          periods: months.map((m, i) => ({
            period_start: m,
            count: 3000,
            absent_days_per_head_annual: i < 5 ? 12 : 13,
          })),
        },
        "Relief pool": { label: "Relief pool", count: 4, suppressed: true, periods: [] },
      },
    },
  },
};

const interventions = [
  {
    id: "icv-001",
    title: "Rostering review",
    status: "Measuring",
    created: "2026-04-02",
    target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
    comparators: ["Standard ops"],
  },
  {
    id: "icv-002",
    title: "Fatigue clinic",
    status: "Running",
    created: "2026-09-02",
    target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
    comparators: null,
  },
];

const playbooks = [
  {
    id: "pb-001",
    intervention_id: "icv-001",
    title: "Playbook for Rostering review",
    status: "Approved",
    drafted_at: "2026-04-03",
    drafted_by: "sipho.dlamini@example.com",
    drafted_by_role: "analyst",
    drafted_with: "agent",
    steps: [{ action: "Cap shifts across the cohort.", owner: "Shift scheduling", horizon: "immediate", measure: "absent_days_per_head_annual" }],
    approval: { by: "naledi.khumalo@example.com", by_role: "approver", at: "2026-04-05", decision: "approved" },
  },
  {
    id: "pb-002",
    intervention_id: "icv-002",
    title: "Playbook for Fatigue clinic",
    status: "In review",
    drafted_at: "2026-09-03",
    drafted_by: "sipho.dlamini@example.com",
    drafted_by_role: "analyst",
    drafted_with: "template",
    steps: [{ action: "Offer screening to the cohort.", owner: "Occupational health", horizon: "short", measure: "mean_fatigue" }],
    approval: null,
  },
];

const rules = [
  { id: "r1", name: "Elevated risk", measure: "high_or_critical_share", comparison: "above", threshold: 0.2, scope: { dimension: "cohort_load" }, enabled: true },
];

const build = (over = {}) =>
  buildBriefing({
    interventions,
    playbooks,
    rules,
    tasks: [],
    dimensions,
    cohorts,
    series,
    suppressionThreshold: 5,
    asOf: "2026-10-24",
    tenant: { name: "Demo Industrial Group", environment: "demo", synthetic: true },
    ...over,
  });

// --- Decisions lead ---------------------------------------------------------

test("a playbook awaiting approval is reported, with how long it has waited", () => {
  const b = build();
  const waiting = b.decisions.playbooks_awaiting_approval;
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].id, "pb-002");
  assert.equal(waiting[0].waiting_days, 51);
});

test("an approved step nobody released is reported as a decision that changed nothing", () => {
  const b = build();
  assert.equal(b.decisions.approved_steps_not_yet_sent.length, 1);
  assert.equal(b.decisions.approved_steps_not_yet_sent[0].owner, "Shift scheduling");
});

test("a released step stops being listed as outstanding", () => {
  const b = build({
    tasks: [
      {
        playbook_id: "pb-001",
        instruction: "Cap shifts across the cohort.",
        status: "Dispatched",
        dispatched_at: "2026-10-20",
      },
    ],
  });
  assert.equal(b.decisions.approved_steps_not_yet_sent.length, 0);
  assert.equal(b.activity.tasks_recorded, 1);
  assert.match(b.activity.tasks_note, /not sent/);
});

test("a rejected playbook is not waiting on anybody", () => {
  const b = build({
    playbooks: [{ ...playbooks[1], status: "Rejected", approval: { decision: "rejected", by: "x@example.com" } }],
  });
  assert.equal(b.decisions.playbooks_awaiting_approval.length, 0);
});

test("the headline leads with what needs a person", () => {
  const b = build();
  const h = headline(b);
  assert.match(h, /waiting on a person/);
  // And says so plainly when there is nothing, rather than finding something
  // cheerful to lead with.
  const quiet = headline(build({ playbooks: [], interventions: [], rules: [] }));
  assert.match(quiet, /^Nothing is waiting on a decision/);
});

// --- The caveat travels -----------------------------------------------------

test("a measured outcome carries its full caveat inside the briefing", () => {
  const b = build();
  assert.equal(b.outcomes.measured.length, 1);
  const m = b.outcomes.measured[0];
  assert.match(m.caveat, /not evidence that the intervention caused/);
  assert.match(m.caveat, /selected for being extreme/);
  assert.ok(m.provenance.includes("Comparators frozen"));
});

test("nothing a briefing asserts claims a cause, or publishes a percentage change", () => {
  /*
    Scoped to the fields that make a claim, not the whole object. The caveat has
    to contain the word "caused" in order to deny causation, so a blanket search
    over the blob flags the one sentence doing the work. That is the third time
    a whole-text check has caught a correct disclaimer in this module; the
    lesson is that these screens belong on assertions, never on governance
    prose.
  */
  const b = build();
  for (const m of b.outcomes.measured) {
    const claims = [m.raw, m.context, m.headline].filter(Boolean).join(" ").toLowerCase();
    for (const word of ["caused", "thanks to", "proves", "resulted in", "achieved a", "because of"]) {
      assert.ok(!claims.includes(word), `a briefing claim implies causation: ${word}`);
    }
    assert.ok(!/%/.test(claims), "a percentage reached a briefing claim");
  }
  // And the headline makes no claim about direction at all.
  assert.ok(!/better|worse|success/i.test(headline(b)), headline(b));
});

test("the caveat does say the word, which is the point of a denial", () => {
  // The inverse of the test above, so a future tidy cannot quietly delete the
  // denial to make a whole-text search pass.
  const b = build();
  for (const m of b.outcomes.measured) {
    assert.match(m.caveat, /caused/);
  }
});

test("an unmeasurable intervention is listed with its reason, not omitted", () => {
  const b = build();
  const n = b.outcomes.not_yet_measurable;
  assert.equal(n.length, 1);
  assert.equal(n[0].id, "icv-002");
  assert.ok(n[0].reasons.some((r) => r.includes("knowing the answer")));
});

test("with no series published, nothing is measured and the reason says so", () => {
  const b = build({ series: null });
  assert.equal(b.outcomes.measured.length, 0);
  assert.equal(b.outcomes.not_yet_measurable.length, 2);
  assert.ok(b.outcomes.not_yet_measurable[0].reasons[0].includes("no cohort series"));
});

// --- Suppression ------------------------------------------------------------

test("a suppressed cohort never appears in a briefing", () => {
  const b = build();
  const blob = JSON.stringify(b);
  assert.ok(!blob.includes("Relief pool"), "a withheld cohort was named in the briefing");
});

test("a rule that skipped a cohort says so, because silence is not safety", () => {
  const b = build();
  assert.equal(b.attention.cohorts_skipped_by_rules, 1);
  assert.match(b.attention.skipped_note, /Silence on those is not safety/);
});

test("rules firing are reported with their cohort and value", () => {
  const b = build();
  const firing = b.attention.rules_firing;
  assert.equal(firing.length, 1);
  assert.equal(firing[0].cohort, "High-intensity ops");
  assert.equal(firing[0].rule, "Elevated risk");
  assert.equal(firing[0].value, 0.31);
});

test("a disabled rule is not evaluated", () => {
  const b = build({ rules: [{ ...rules[0], enabled: false }] });
  assert.equal(b.attention.rules_firing.length, 0);
});

// --- No individual ----------------------------------------------------------

test("a briefing carries no individual field", () => {
  const blob = JSON.stringify(build());
  for (const field of ["employee_id", "employee_key", "id_number", "individuals"]) {
    assert.ok(!blob.includes(field), `the briefing carries ${field}`);
  }
});

test("the footer states what the briefing is, because it gets forwarded", () => {
  const b = build();
  assert.match(b.footer.level, /cohort level/);
  assert.match(b.footer.level, /withheld/);
  assert.match(b.footer.not_a_decision, /section 71/);
  assert.match(b.footer.not_a_decision, /decides nothing/);
});

// --- Empty and degenerate inputs --------------------------------------------

test("an empty control centre produces a briefing rather than an error", () => {
  const b = buildBriefing({});
  assert.equal(b.decisions.count, 0);
  assert.equal(b.outcomes.measured.length, 0);
  assert.ok(headline(b));
});

test("the as-of date is taken from the caller, so one render reads the same for everybody", () => {
  const b = build({ asOf: "2026-12-01" });
  assert.equal(b.as_of, "2026-12-01");
  // Which also moves the waiting figure, deliberately.
  assert.equal(b.decisions.playbooks_awaiting_approval[0].waiting_days, 89);
});
