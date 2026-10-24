/*
  Deterministic answers for the three sick-leave agents, for a deployment with
  no agent key.

  The panels used to render an "Agent offline" box. That was honest and it meant
  three of the four agent surfaces in the demo were dark, so a visitor walking
  the product saw the governance, the cohorts and the costs, and then three
  empty boxes where the thing being sold was supposed to be.

  What this does instead: answers the panel's own suggested questions from the
  grounding the screen already assembles, with arithmetic and nothing else. It
  is not a language model and it does not pretend to be. Every answer is
  prefixed with a line saying so, `source` is `summary` rather than `model` in
  the response, and the panel badges it.

  Two things it deliberately does not do.

  It does not answer an arbitrary question. A typed question that is not one of
  the suggested ones gets a short, honest refusal naming what it can do, rather
  than a generic paragraph that reads like an answer. A canned paragraph
  returned for any input is the thing that would make a buyer think the product
  is smarter than it is, and then feel misled.

  It does not soften the Case Assistant's constraints. The case summary is the
  same care-and-support shape the prompt demands, it names no employment
  consequence, and it stays on the drivers and the entitlement framing. The
  clinical guardrails are not a feature of the model; they are a feature of the
  product, so they hold whether or not a model is answering.
*/

const NOT_A_MODEL =
  "Summarised from the figures on this screen by the dashboard, not by a language model: this deployment has no agent key configured.";

/*
  Grouped with a plain ASCII space, written out rather than via toLocaleString.
  The locale separator for en-ZA is a non-breaking space, which looks identical
  on screen and is a different character in a string comparison: the first
  version of this passed in the browser and failed its own test.
*/
const group = (n) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const rand = (n) => (n == null ? "unknown" : "R" + group(n));
const pct = (n) => (n == null ? "unknown" : `${Math.round(n * 10) / 10}%`);
const num = (n) => (n == null ? "unknown" : group(n));

function worstCells(concentration, k = 3) {
  const cells = [];
  for (const row of concentration || []) {
    for (const cell of row.cells || []) {
      if (cell.suppressed || cell.ratePct == null) continue;
      cells.push({ site: row.site, fn: cell.function, rate: cell.ratePct, headcount: cell.headcount });
    }
  }
  return cells.sort((a, b) => b.rate - a.rate).slice(0, k);
}

function topChapters(mix, k = 3) {
  return (mix || [])
    .filter((c) => !c.suppressed && c.shareDaysPct != null)
    .sort((a, b) => b.shareDaysPct - a.shareDaysPct)
    .slice(0, k);
}

/* --- Portfolio Analyst ---------------------------------------------------- */

function analystConcentration(ctx) {
  const h = ctx.headline || {};
  const worst = worstCells(ctx.concentrationMatrix);
  const chapters = topChapters(ctx.conditionMixByChapter);

  const lines = [
    `**Where it sits.** ${pct(h.sickLeaveRatePct)} sick leave rate over the ${String(
      ctx.period || "period",
    ).toLowerCase()}, ${num(h.totalSickDays)} days, ${rand(h.indicativeCostRand)} indicative. Of that, ${rand(
      h.coverCostRand,
    )} is cover rather than pay, which is the half a roster change can move.`,
  ];

  if (worst.length) {
    lines.push(
      `**Where it concentrates.** ` +
        worst.map((c) => `${c.site}, ${c.fn} at ${pct(c.rate)} across ${num(c.headcount)} people`).join("; ") +
        ".",
    );
  }
  if (chapters.length) {
    lines.push(
      `**What is driving it.** ` +
        chapters.map((c) => `${c.chapter} at ${pct(c.shareDaysPct)} of days`).join(", ") +
        ".",
    );
  }
  lines.push(
    `**The leverage.** Cover cost follows the shift-critical functions, so the largest single move is reducing the share of absence that has to be backfilled on the day rather than reducing absence itself. Rand figures are indicative and pre-data.`,
  );
  return lines.join("\n\n");
}

function analystEntitlement(ctx) {
  const burn = ctx.entitlementBurn || {};
  const bands = burn.bands || [];
  const near = bands.filter((b) => /76|Exhaust/i.test(b.band)).reduce((a, b) => a + (b.count || 0), 0);
  const p = burn.projection || {};
  const cohorts = (ctx.cohortSummary || [])
    .filter((c) => !c.suppressed && c.pctAbove75Entitlement != null)
    .sort((a, b) => b.pctAbove75Entitlement - a.pctAbove75Entitlement)
    .slice(0, 3);

  const lines = [
    `**Position now.** ${num(near)} people are above 75% of entitlement or have exhausted it.`,
    `**Forecast.** ${num(p.in3Months)} more within three months, ${num(p.in6Months)} within six, ${num(
      p.in12Months,
    )} within twelve.`,
  ];
  if (cohorts.length) {
    lines.push(
      `**Closest cohorts.** ` +
        cohorts
          .map((c) => `${c.site} on ${c.shiftPattern}, ${pct(c.pctAbove75Entitlement)} above 75%`)
          .join("; ") +
        ".",
    );
  }
  lines.push(
    `**How to read it.** Entitlement exhaustion is a workforce planning and employee financial strain signal. It is not a behavioural observation and is not used for review.`,
  );
  return lines.join("\n\n");
}

function analystLeverage(ctx) {
  const h = ctx.headline || {};
  const worst = worstCells(ctx.concentrationMatrix, 2);
  const chapters = topChapters(ctx.conditionMixByChapter, 2);
  return [
    `**Highest leverage.** The cover half of the cost, ${rand(
      h.coverCostRand,
    )} of ${rand(h.indicativeCostRand)} indicative, sits in the shift-critical functions where an absence must be filled the same day.`,
    worst.length
      ? `**Where to start.** ${worst
          .map((c) => `${c.site}, ${c.fn} at ${pct(c.rate)}`)
          .join(" and ")}. Those two cells carry the highest rate on the matrix.`
      : "",
    chapters.length
      ? `**What the plan should address.** ${chapters
          .map((c) => c.chapter)
          .join(" and ")} together account for ${pct(
          chapters.reduce((a, c) => a + c.shareDaysPct, 0),
        )} of days lost.`
      : "",
    `**Caution.** This is a summary of the figures on screen, not a recommendation tested against outcomes. Any intervention goes through the control centre, where comparators are frozen before it runs.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* --- Cover and Roster Coordinator ---------------------------------------- */

function coordinatorCoverGap(ctx) {
  const sites = (ctx.predictedSickLeaveRateBySite || [])
    .slice()
    .sort((a, b) => (b.predictedRatePct || 0) - (a.predictedRatePct || 0));
  const heat = (ctx.coverGapHeatmapNext28Days || [])
    .map((r) => ({ ...r, total: (r.days || []).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  return [
    `**The gap.** ${num(ctx.totalCoverGapShifts)} cover-gap shifts over the next four weeks, ${rand(
      ctx.overtimeBackfillCostRandIndicative,
    )} of indicative overtime backfill.`,
    heat.length
      ? `**Where it lands hardest.** ` +
        heat.map((r) => `${r.site} on ${r.shiftPattern}, ${num(r.total)} shifts`).join("; ") +
        "."
      : "",
    sites.length
      ? `**Predicted rate by site.** ` +
        sites.map((s) => `${s.site} ${pct(s.predictedRatePct)}`).join(", ") +
        "."
      : "",
    `**What to watch.** The continuous rosters carry the gap because they have the fewest scheduled days to absorb it. Return-to-work caseload is ${num(
      ctx.returnToWorkCaseload,
    )}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function coordinatorRelief(ctx) {
  const heat = (ctx.coverGapHeatmapNext28Days || [])
    .map((r) => ({ ...r, total: (r.days || []).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
  const worst = heat[0];
  const share = worst && ctx.totalCoverGapShifts ? worst.total / ctx.totalCoverGapShifts : null;

  return [
    worst
      ? `**The single change.** ${worst.site} on ${worst.shiftPattern} carries ${num(
          worst.total,
        )} of the ${num(ctx.totalCoverGapShifts)} gap shifts${
          share ? `, ${pct(share * 100)} of the total` : ""
        }. Relief placed there before overtime is offered is the change with the most cost attached to it.`
      : "",
    `**Why relief rather than overtime.** Overtime backfill is charged at a multiplier of the day rate, so the same shift filled from a relief pool costs less and does not add hours to people already on the roster carrying the absence.`,
    `**What to watch next.** Whether relief is coming out of the same cohort repeatedly. That is the failure mode: the gap closes and the fatigue moves.`,
    `All Rand figures are indicative and pre-data.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function coordinatorExhaustion(ctx) {
  const rows = (ctx.entitlementExhaustionForecastByCohort || [])
    .slice()
    .sort((a, b) => (b.in3Months || 0) - (a.in3Months || 0))
    .slice(0, 3);
  const cert = ctx.certificationCompliance?.overall;

  return [
    rows.length
      ? `**Plan for these first.** ` +
        rows
          .map((r) => `${r.site} on ${r.shiftPattern}, ${num(r.in3Months)} within three months`)
          .join("; ") +
        "."
      : "",
    `**Why it matters operationally.** Once entitlement is exhausted, further sick days fall outside paid entitlement. That is financial strain on the employee and an attendance planning problem for the roster, and it is treated as both, never as a behavioural signal.`,
    cert
      ? `**Records.** ${pct(cert.ratePct)} of qualifying spells have a certificate on file, ${num(
          cert.missing,
        )} do not. That is a records quality measure, not a judgement about anybody.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* --- Case Assistant ------------------------------------------------------- */

function caseSupportPlan(ctx) {
  const drivers = (ctx.model?.drivers || []).slice(0, 3);
  const ent = ctx.entitlement || {};
  const chapters = [...new Set((ctx.absenceHistoryByChapter || []).map((e) => e.icd10Chapter))].slice(0, 3);

  const steps = drivers.length
    ? drivers.map((d) => {
        const label = typeof d === "string" ? d : d.label || d.name || "the recorded driver";
        return `- **${label}.** Offer an occupational health conversation about it, and where the employer's medical aid or on-site clinic covers it, a referral. Voluntary, and declining it changes nothing.`;
      })
    : ["- Offer an occupational health conversation covering workload, sleep and any ongoing condition."];

  return [
    `**Drivers worth acting on**`,
    steps.join("\n"),
    chapters.length
      ? `**Recorded at chapter level.** ${chapters.join(", ")}. Chapter level only, with no specific diagnosis stored.`
      : "",
    `**Planning context for you, not a warning about them.** ${num(ent.daysRemaining)} of ${num(
      ent.entitlementDays,
    )} entitlement days remain in the cycle that began ${ent.cycleStartDate || "at the recorded date"}. If further leave is needed beyond that, it falls outside paid entitlement, which is worth raising supportively and early.`,
    `**Not in scope.** This plan contains no assessment of whether absence was warranted, no comparison against colleagues, and nothing for a performance or disciplinary process. Clinical absence data is not used for employment decisions.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function caseOhSteps(ctx) {
  const drivers = (ctx.model?.drivers || []).slice(0, 3);
  return [
    `**Occupational health steps for the top drivers**`,
    (drivers.length
      ? drivers.map((d) => {
          const label = typeof d === "string" ? d : d.label || d.name || "the recorded driver";
          return `- **${label}.** Screen for it at the on-site clinic, and adjust duties or roster where the clinician judges it appropriate. Any adjustment is a workplace change, agreed with the employee.`;
        })
      : ["- Screen at the on-site clinic for workload, sleep and any ongoing condition."]
    ).join("\n"),
    `**Shift pattern.** ${ctx.shiftPattern || "The recorded roster"} at ${
      ctx.site || "the recorded site"
    }. A rest-day or rotation change is often available before anything clinical is needed.`,
    `**A note on the score.** The risk tier shown is modelled, not a diagnosis. It points at where to look; the clinical judgement is yours.`,
  ].join("\n\n");
}

function casePathways(ctx) {
  const chapters = [...new Set((ctx.absenceHistoryByChapter || []).map((e) => e.icd10Chapter))];
  return [
    `**Pathways that apply**`,
    `- The employer's medical aid scheme, for anything needing ongoing management.`,
    `- The on-site clinic, for screening and for return-to-work review.`,
    `- The employee assistance programme, which the employee can use directly without going through the line.`,
    chapters.length
      ? `**Recorded chapters.** ${chapters.join(
          ", ",
        )}. Which specific pathway fits is a clinical judgement; this lists what is available rather than choosing for you.`
      : "",
    `**Consent.** Routing into a pathway is offered, not assigned, and whether the employee takes it is not reported back to the line.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/*
  The question router.

  Matched on the suggested questions the panel actually offers, by keyword
  rather than by exact string so a lightly edited question still lands. Anything
  else is refused by name.
*/
const ANSWERS = {
  analyst: [
    { when: /concentrat|where.*cost|cost.*where/i, answer: analystConcentration },
    { when: /entitlement|exhaust/i, answer: analystEntitlement },
    { when: /leverage|intervention|highest/i, answer: analystLeverage },
  ],
  coordinator: [
    { when: /cover gap|gap.*hard|next four weeks|where.*gap/i, answer: coordinatorCoverGap },
    { when: /relief|overtime/i, answer: coordinatorRelief },
    { when: /entitlement|exhaust/i, answer: coordinatorExhaustion },
  ],
  case: [
    { when: /support plan|draft.*plan/i, answer: caseSupportPlan },
    { when: /occupational health|steps|driver/i, answer: caseOhSteps },
    { when: /pathway|medical aid|referral/i, answer: casePathways },
  ],
};

export function canAnswer(agent, question) {
  return (ANSWERS[agent] || []).some((a) => a.when.test(String(question || "")));
}

/*
  The refusal for a question this cannot answer. It names the three it can,
  because a user whose typed question is declined needs to know what to ask
  rather than that the feature is broken.
*/
export function refusal(agent, suggested) {
  const list = (suggested || []).map((s) => `- ${s}`).join("\n");
  return [
    NOT_A_MODEL,
    "",
    `This deployment can answer the suggested questions below from the figures on screen. It cannot answer a question outside them, and a generic paragraph that read like an answer would be worse than saying so.`,
    list ? `\n${list}` : "",
    `\nConfigure an agent key to ask this panel anything.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function fallbackAnswer(agent, question, context) {
  const match = (ANSWERS[agent] || []).find((a) => a.when.test(String(question || "")));
  if (!match) return null;
  return `${NOT_A_MODEL}\n\n${match.answer(context || {})}`;
}

export { NOT_A_MODEL };
