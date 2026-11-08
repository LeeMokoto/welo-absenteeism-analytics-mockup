/*
  The grounding objects passed to the absence agents.

  An agent reasons over this object and nothing else. So the rule that governs
  these builders is not "send what might help", it is "send exactly what the
  screen already shows the reader, and nothing the reader cannot see".

  That matters more here than it looks. The absence feed carries suppressed
  cohorts as rows with no figures, and the screens render them as n<5. If a
  builder passed the raw cohort list through, the agent would be reasoning over
  a row the reader is not allowed to see, and the easiest way for a suppressed
  figure to reach a prospect's screen is an agent repeating it back in prose.
  So suppressed cohorts are stripped here, before the object exists, and the
  agent is told how many were withheld rather than given them.

  Nothing in this module carries an individual record, so there is no record to
  leave out. That is a property of the data, not of these functions, and the
  module states it as a guardrail.
*/

/*
  Cohorts the reader can see, reduced to named fields.

  An allowlist, not a strip. The first version of this filtered suppressed rows
  and passed the rest of each row through whole, which shipped `mean_bradford`
  and `freq_trigger` to the coordinator inside every cohort while the payload's
  own note said attendance measures were withheld. A test caught it, but the
  shape was the problem: with a denylist, a field added upstream reaches the
  agent by default and nobody decides that it should.

  So a builder names what it sends. A new column in the feed is invisible to
  the agents until somebody adds it here on purpose.

  The withheld count goes in so the agent can say "one cohort is not shown"
  rather than answering as though the visible rows were all of them.
*/
function reportable(rows, fields) {
  const all = rows || [];
  const visible = all.filter((c) => !c.suppressed);
  const shown = visible.map((c) => {
    const out = {};
    for (const f of fields) if (c[f] !== undefined) out[f] = c[f];
    return out;
  });
  return { shown, withheld: all.length - visible.length };
}

// What a cohort row may carry into an analyst payload.
const COHORT_FIELDS = [
  "label",
  "count",
  "predicted_absent_days_90d",
  "predicted_absent_days_annual",
  "cost_exposure_rand",
  "addressable_saving_rand",
  "absent_days_per_head_annual",
  "high_or_critical_count",
  "high_or_critical_share",
  "mean_fatigue",
];

/*
  What an operational cohort row may carry into a coordinator payload.

  `freq_trigger` and `mean_bradford` are deliberately not on this list. They
  are attendance measures, widely used punitively, and this platform uses them
  only to size a support caseload on a screen whose copy says so. An agent
  given them without that copy would read them as a ranking of who is absent
  most often.
*/
const OPS_COHORT_FIELDS = [
  "label",
  "count",
  "cover_gap_days_90d",
  "backfill_cost_rand_90d",
  "overtime_mean_14d",
  "rtw_caseload",
  "long_leave_gap",
];

export function buildAnalystContext(portfolio) {
  const h = portfolio.headline || {};
  const cohorts = reportable((portfolio.cohorts || {}).cohort_load, COHORT_FIELDS);
  const fatigue = reportable((portfolio.cohorts || {}).cohort_fatigue, COHORT_FIELDS);
  const lifestyle = reportable((portfolio.cohorts || {}).cohort_lifestyle, COHORT_FIELDS);

  return {
    note:
      "Modelled, not measured. Cost figures are indicative and rest on a placeholder day rate. " +
      "Cohort level only: this payload contains no individual records.",
    suppression: {
      threshold: portfolio.suppression_threshold ?? 5,
      rule: "Cohorts below the threshold carry no figures and are not included here.",
      withheld_cohorts: cohorts.withheld + fatigue.withheld + lifestyle.withheld,
    },
    headline: {
      covered_lives: h.covered_lives,
      predicted_absent_days_90d: h.predicted_absent_days_90d,
      predicted_absent_days_annual: h.predicted_absent_days_annual,
      absence_cost_exposure_rand: h.absence_cost_exposure_rand,
      projected_addressable_saving_rand: h.projected_addressable_saving_rand,
      fatigue_high_or_critical_share: h.fatigue_high_or_critical_share,
    },
    risk_distribution: portfolio.risk_distribution,
    fatigue_summary: (portfolio.fatigue_burnout || {}).summary,
    cohorts_by_operational_load: cohorts.shown,
    cohorts_by_fatigue_band: fatigue.shown,
    cohorts_by_lifestyle_risk: lifestyle.shown,
    // The saving is a benchmark applied to the high-risk band, not an outcome.
    // The agent is told that here as well as in its prompt, because a figure
    // and its caveat should travel together.
    addressable_saving_basis:
      "A benchmark reduction applied to the high-risk band. Projected, never measured, and not attributable to any intervention.",
  };
}

export function buildCoordinatorContext(portfolio) {
  const ops = portfolio.hr_ops || {};
  const byCohort = reportable(ops.by_cohort, OPS_COHORT_FIELDS);

  return {
    note:
      "Modelled projections, not live. Cost figures are indicative. Cohort level only: " +
      "this payload contains no individual records.",
    suppression: {
      threshold: portfolio.suppression_threshold ?? 5,
      withheld_cohorts: byCohort.withheld,
    },
    // ops.headline carries freq_trigger_count, which is the same attendance
    // measure, so the headline is named out field by field too.
    headline: {
      covered_lives: (ops.headline || {}).covered_lives,
      absence_rate: (ops.headline || {}).absence_rate,
      cover_gap_days_90d: (ops.headline || {}).cover_gap_days_90d,
      backfill_cost_rand_90d: (ops.headline || {}).backfill_cost_rand_90d,
      rtw_caseload: (ops.headline || {}).rtw_caseload,
    },
    cover: ops.cover,
    return_to_work: ops.return_to_work,
    by_cohort: byCohort.shown,
    assumptions: ops.assumptions,
    /*
      Absence frequency and the Bradford index are deliberately not sent.

      They are on the operations screen, where the copy explains that they size
      a support caseload and are not used for attendance management. Stripped
      of that copy and handed to an agent they read as a ranking of who is
      absent most often, and the likeliest question in a staffing conversation
      is the one that turns them into a list of people to speak to. The agent
      cannot misuse a measure it was never given.
    */
    frequency_measures:
      "Withheld from this payload on purpose. Absence frequency and Bradford scores are attendance measures that are widely used punitively; this platform sizes a support caseload with them and does not expose them to the agents.",
  };
}
