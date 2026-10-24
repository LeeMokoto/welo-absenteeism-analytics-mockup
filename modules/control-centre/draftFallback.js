/*
  The drafter of last resort.

  The playbook screen's point is the governance: a plan is drafted, checked
  against rules that can refuse it, and decided by somebody who did not draft
  it. None of that depends on a language model, but all of it was unreachable
  without one, because the drafting endpoint returned 503 with no key
  configured. A demo tenant that cannot demonstrate its own approval flow is a
  worse problem than a demo tenant without an LLM.

  So: when no key is configured, a plan is assembled here instead. It is a
  template filled from the targeted cohort's own figures, it is deterministic,
  and it is labelled `template` rather than `agent` everywhere it appears, down
  to the record that gets filed. Overclaiming the AI is the exact thing this
  file must not do, so the label is not a nicety.

  Two rules it keeps:

  - It goes through the same validation as a model draft. A template that
    bypassed the checks would make the checks look like theatre.
  - It proposes nothing a model draft would be refused for. The refusal story
    is told by the seeded rejected playbook, which is a real example kept on
    purpose; this drafter is not the place to manufacture one, because writing
    disciplinary language into the product to demonstrate that we reject
    disciplinary language is not a trade worth making.

  What it is not: it is not a fallback that makes the model look unnecessary.
  The steps are generic by construction, the WHY is arithmetic, and the screen
  says so. The model reads the cohort's actual driver mix and writes to it,
  which is the difference a buyer should see when the key is configured.
*/

import { MEASURES } from "./alerts.js";

const MEASURE = {
  fatigue: "mean_fatigue",
  load: "absent_days_per_head_annual",
  share: "high_or_critical_share",
};

/*
  A template per targetable dimension, because the lever is different in each.
  Operational load is a rostering problem, fatigue is an occupational health
  one, and tenure is an onboarding one, and a plan that did not know the
  difference would read as filler.
*/
const TEMPLATES = {
  cohort_load: {
    lever: "rostering",
    steps: [
      {
        action:
          "Cap consecutive shifts across the cohort and hold a rest-day floor, applied to the roster rather than to individuals.",
        owner: "Shift scheduling",
        horizon: "immediate",
        measure: MEASURE.load,
      },
      {
        action:
          "Move relief-pool cover to the sites carrying the largest gap before overtime is offered, so cover does not come out of the same people.",
        owner: "Operations lead",
        horizon: "short",
        measure: MEASURE.load,
      },
      {
        action:
          "Review the roster change with the cohort's shift leads each quarter, and keep or revert it on the measure rather than on impression.",
        owner: "Operations lead",
        horizon: "sustained",
        measure: MEASURE.fatigue,
      },
    ],
  },
  cohort_fatigue: {
    lever: "occupational health",
    steps: [
      {
        action:
          "Offer fatigue and sleep screening to the whole cohort through the on-site clinic, opt in, during shift hours so attending costs nobody pay.",
        owner: "Occupational health",
        horizon: "immediate",
        measure: MEASURE.fatigue,
      },
      {
        action:
          "Route anyone who wants it into the existing medical aid care pathway, with no report back to the line about who attended.",
        owner: "Occupational health",
        horizon: "short",
        measure: null,
      },
      {
        action:
          "Brief shift leads on the rest-day floor and on what they may and may not ask about a screening.",
        owner: "Health and safety",
        horizon: "immediate",
        measure: null,
      },
    ],
  },
  cohort_tenure: {
    lever: "onboarding and support",
    steps: [
      {
        action:
          "Offer a structured, voluntary return-to-work conversation focused on workload and support, with a written note of what was agreed.",
        owner: "HR business partner",
        horizon: "short",
        measure: MEASURE.load,
      },
      {
        action:
          "Pair the cohort with an experienced buddy on the same shift pattern for the first rotation after any absence of a week or more.",
        owner: "Operations lead",
        horizon: "short",
        measure: null,
      },
      {
        action:
          "Review induction coverage of manual handling and shift-sleep guidance with the wellness programme.",
        owner: "Wellness programme",
        horizon: "sustained",
        measure: MEASURE.fatigue,
      },
    ],
  },
};

// Used when the dimension has no template, which should not happen while
// targeting is restricted to the three above. Generic on purpose rather than
// absent: a blank draft tells the user nothing about why it is blank.
const GENERIC = {
  lever: "cohort support",
  steps: [
    {
      action:
        "Review the cohort's operational load and health screening coverage with the people accountable for both, and agree one change to each.",
      owner: "Occupational health",
      horizon: "short",
      measure: MEASURE.load,
    },
    {
      action:
        "Report the agreed changes back to the cohort, so the people affected know what was decided about them and why.",
      owner: "HR business partner",
      horizon: "immediate",
      measure: null,
    },
  ],
};

function figuresFor(target, cohorts) {
  const row = ((cohorts || {})[target?.dimension] || []).find((c) => c.key === target?.cohort);
  if (!row || row.suppressed) return null;
  return row;
}

/*
  The WHY paragraph. Arithmetic over the cohort's own row, with the comparison
  that makes the case: this cohort against the rest of its dimension. If the
  figures are not there, it says so rather than writing a sentence that sounds
  like evidence.
*/
function whyFor(target, cohorts) {
  const row = figuresFor(target, cohorts);
  if (!row) {
    return (
      `${target?.cohort} carries no published figures in the current feed, so this plan rests on ` +
      `the reason recorded on the intervention rather than on the cohort's own numbers.`
    );
  }

  const others = ((cohorts || {})[target.dimension] || []).filter(
    (c) => c.key !== target.cohort && !c.suppressed && c.absent_days_per_head_annual != null,
  );
  const rest = others.length
    ? others.reduce((a, c) => a + c.absent_days_per_head_annual, 0) / others.length
    : null;

  const parts = [
    `${row.count} people, ${row.absent_days_per_head_annual} absent days per head a year`,
  ];
  if (rest !== null) {
    parts.push(`against ${Math.round(rest * 10) / 10} for the rest of this dimension`);
  }
  if (row.mean_fatigue != null) parts.push(`mean fatigue ${row.mean_fatigue}`);
  if (row.high_or_critical_share != null) {
    parts.push(
      `${Math.round(row.high_or_critical_share * 1000) / 10} percent at high or critical risk`,
    );
  }

  // Phrased to avoid an article before the lever: "a occupational health plan"
  // is what the obvious sentence produces.
  const lever = (TEMPLATES[target.dimension] || GENERIC).lever;
  return (
    `${parts.join(", ")}. This plan works the ${lever} lever and is assembled from the ` +
    `cohort's reported figures, not written for this cohort specifically.`
  );
}

/*
  Build a draft. Pure and deterministic: the same intervention and the same feed
  produce the same plan, which also makes it testable.
*/
export function fallbackDraft(intervention, cohorts) {
  const target = (intervention?.target || [])[0] || null;
  const template = (target && TEMPLATES[target.dimension]) || GENERIC;

  return {
    steps: template.steps.map((s) => ({ ...s })),
    why: whyFor(target, cohorts),
    // Carried on the record, so a reviewer reading this plan in six months can
    // see it was not model drafted without having to ask anybody.
    drafted_with: "template",
  };
}

/*
  What the interface says about it. Separate from the draft so the wording lives
  in one place and cannot drift between the API's note and the screen's badge.
*/
export const FALLBACK_NOTICE =
  "Assembled from a template using this cohort's reported figures. No language model was called: this deployment has no agent key configured. The plan is held to exactly the same rules as a model draft, and it is filed as template rather than agent so the record says how it was produced.";

// Sanity, asserted in tests rather than assumed: every template step names an
// owner and a horizon, and every measure is one the platform reports.
export function templateIntegrity() {
  const problems = [];
  for (const [key, t] of Object.entries({ ...TEMPLATES, generic: GENERIC })) {
    if (!t.steps.length) problems.push(`${key} has no steps`);
    for (const [i, s] of t.steps.entries()) {
      if (!s.owner) problems.push(`${key} step ${i + 1} has no owner`);
      if (!s.horizon) problems.push(`${key} step ${i + 1} has no horizon`);
      if (s.measure && !MEASURES.some((m) => m.key === s.measure)) {
        problems.push(`${key} step ${i + 1} names an unreported measure ${s.measure}`);
      }
    }
    if (!t.steps.some((s) => s.measure)) problems.push(`${key} measures nothing`);
  }
  return problems;
}
