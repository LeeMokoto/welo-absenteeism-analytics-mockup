/*
  Deterministic answers for the two absence agents, for a deployment with no
  agent key.

  Same bargain as the sick leave fallback. The panel's own suggested questions
  are answered from the grounding the screen already assembled, by arithmetic
  and nothing else, and every answer opens by saying it is not a language
  model. A question outside that set gets a short refusal naming what the panel
  can do, never a generic paragraph that reads like an answer.

  One thing this must not inherit from the screens it summarises: their
  confidence. The absence figures are modelled, and the cost figures rest on a
  placeholder day rate. An arithmetic summary that dropped those two caveats
  would read more certain than the model does, so each answer carries the one
  that applies to what it just said.
*/

const NOT_A_MODEL =
  "Summarised from the figures on this screen by the dashboard, not by a language model: this deployment has no agent key configured.";

// Grouped with a plain ASCII space rather than toLocaleString, whose separator
// for en-ZA is a non-breaking space: identical on screen, a different
// character in a comparison, and the reason the sick leave version once passed
// in a browser and failed its own test.
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const num = (n) => (n == null ? "unknown" : group(n));
const rand = (n) => (n == null ? "unknown" : "R" + group(n));
const pct1 = (n) => (n == null ? "unknown" : `${Math.round(n * 10) / 10}%`);
const share = (n) => (n == null ? "unknown" : `${Math.round(n * 1000) / 10}%`);

const byDesc = (rows, key) =>
  [...(rows || [])].filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]);

// --- Analyst ---------------------------------------------------------------

function analystConcentration(ctx) {
  const h = ctx.headline || {};
  const top = byDesc(ctx.cohorts_by_operational_load, "cost_exposure_rand");
  const lead = top[0];
  const totalShown = top.reduce((a, c) => a + (c.cost_exposure_rand || 0), 0);
  const leadShare = lead && totalShown ? (lead.cost_exposure_rand / totalShown) * 100 : null;
  const perHead = byDesc(ctx.cohorts_by_operational_load, "absent_days_per_head_annual")[0];

  return [
    `**Where it sits.** ${num(h.predicted_absent_days_annual)} predicted absent days a year across ${num(h.covered_lives)} covered lives, ${rand(h.absence_cost_exposure_rand)} of annual exposure.`,
    lead
      ? `**The concentration.** ${lead.label} carries ${rand(lead.cost_exposure_rand)}, about ${pct1(leadShare)} of the exposure in the cohorts shown, on ${num(lead.count)} lives.`
      : "",
    perHead
      ? `**Per head, not just in total.** ${perHead.label} runs ${perHead.absent_days_per_head_annual} absent days per head per year, which is the figure to compare cohorts on: a large cohort can carry the most Rand while being the least affected per person.`
      : "",
    ctx.suppression?.withheld_cohorts
      ? `**Not shown.** ${ctx.suppression.withheld_cohorts} cohort rows are below the suppression threshold and carry no figures, so the totals above cover only the cohorts that can be reported.`
      : "",
    `Absence is modelled, not measured, and the cost figures are indicative.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function analystFatigue(ctx) {
  const h = ctx.headline || {};
  const f = ctx.fatigue_summary || {};
  const bands = ctx.cohorts_by_fatigue_band || [];
  const worst = byDesc(ctx.cohorts_by_operational_load, "mean_fatigue")[0];
  const critical = bands.find((b) => /critical/i.test(b.label || b.key || ""));

  return [
    `**The level.** ${share(h.fatigue_high_or_critical_share)} of covered lives sit in the high or critical fatigue band, mean score ${f.mean ?? "unknown"}, ninetieth percentile ${f.p90 ?? "unknown"}.`,
    worst
      ? `**Where it is worst.** ${worst.label} has the highest mean fatigue at ${worst.mean_fatigue}, on ${num(worst.count)} lives.`
      : "",
    critical
      ? `**What the critical band costs.** ${num(critical.count)} lives in the critical band account for ${num(critical.predicted_absent_days_annual)} predicted absent days a year, ${critical.absent_days_per_head_annual} per head.`
      : "",
    `**Why it matters here.** Fatigue is the strongest operational lever in this model: it is built from overtime, consecutive shifts and sleep, which is what rostering actually changes. Lifestyle load scores higher as a driver but is not something a roster can move.`,
    `Fatigue scores are modelled, not clinical measurements.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function analystLeverage(ctx) {
  const h = ctx.headline || {};
  const top = byDesc(ctx.cohorts_by_operational_load, "addressable_saving_rand")[0];
  const exposure = h.absence_cost_exposure_rand;
  const saving = h.projected_addressable_saving_rand;
  const sharePct = exposure && saving ? (saving / exposure) * 100 : null;

  return [
    `**The headline.** ${rand(saving)} is the projected addressable saving against ${rand(exposure)} of exposure, about ${pct1(sharePct)}.`,
    top
      ? `**Where to start.** ${top.label} carries the largest addressable share at ${rand(top.addressable_saving_rand)}, and it is also where the cover gap and the overtime land, so one roster change touches both the absence and the backfill cost.`
      : "",
    `**What the saving is not.** It is a benchmark reduction applied to the high-risk band. Nothing has been measured, nothing is attributable to an intervention, and no cohort has been through a before and after. The control centre is where a claim like that becomes testable, against comparators frozen before the result is known.`,
    ctx.addressable_saving_basis ? "" : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// --- Coordinator -----------------------------------------------------------

function coordinatorCoverGap(ctx) {
  const h = ctx.headline || {};
  const cover = ctx.cover || {};
  const top = byDesc(ctx.by_cohort, "cover_gap_days_90d");
  const lead = top[0];
  const totalGap = top.reduce((a, c) => a + (c.cover_gap_days_90d || 0), 0);
  const leadShare = lead && totalGap ? (lead.cover_gap_days_90d / totalGap) * 100 : null;

  return [
    `**The gap.** ${num(h.cover_gap_days_90d)} days need backfill over the next 90 days, out of ${num(cover.predicted_absent_days_90d)} predicted absent days. The rest falls where the work can absorb it.`,
    lead
      ? `**Where it lands hardest.** ${lead.label}: ${num(lead.cover_gap_days_90d)} days, about ${pct1(leadShare)} of the gap, costing ${rand(lead.backfill_cost_rand_90d)} to cover.`
      : "",
    `**What it costs.** ${rand(h.backfill_cost_rand_90d)} over 90 days at a day rate of ${rand((ctx.assumptions || {}).day_rate_rand)} plus a cover premium of ${rand((ctx.assumptions || {}).cover_premium_rand)}.`,
    `**The move.** The gap follows the cohorts with the highest cover requirement, so the largest single lever is reducing the share of absence that has to be backfilled on the day, through relief depth, rather than reducing absence itself.`,
    `Cover and overtime are modelled projections, not live, and the Rand figures are indicative.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function coordinatorOvertime(ctx) {
  const cover = ctx.cover || {};
  const top = byDesc(ctx.by_cohort, "overtime_mean_14d");
  const lead = top[0];

  return [
    `**The load.** Mean overtime is ${cover.overtime_mean_14d ?? "unknown"} hours per 14 days, ${share(cover.overtime_high_share)} of the workforce is on high overtime, and the annual total is ${num(cover.overtime_annual_hours)} hours.`,
    lead
      ? `**Where it concentrates.** ${lead.label} runs ${lead.overtime_mean_14d} hours per 14 days, against ${top[top.length - 1]?.label} at ${top[top.length - 1]?.overtime_mean_14d}.`
      : "",
    `**Why it compounds.** Overtime is an input to the fatigue score as well as a cost, so the cohorts carrying the most of it are also the ones the model predicts will be absent most. Backfilling absence with overtime in the same cohort feeds the thing it is covering for.`,
    `Projections, not live figures.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function coordinatorReturnToWork(ctx) {
  const r = ctx.return_to_work || {};
  const top = byDesc(ctx.by_cohort, "rtw_caseload")[0];

  return [
    `**The caseload.** ${num(r.rtw_caseload)} open cases, ${share(r.rtw_share)} of covered lives.`,
    `**The shape of it.** ${num(r.long_leave_gap_count)} have a long gap since their last leave, mean ${num(r.mean_days_since_leave)} days, and ${num(r.repeat_absence_count)} show repeat absence.`,
    top ? `**Where the cases are.** ${top.label} holds ${num(top.rtw_caseload)} of them.` : "",
    `**How to read the long gap.** A long gap since leave is a rest signal: it means people are not taking leave, not that they are taking too much. It sizes a support caseload and is not an attendance measure.`,
    `Modelled, not live.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// --- Dispatch --------------------------------------------------------------

const ANSWERS = {
  analyst: [
    { when: /concentrat|where.*(exposure|absence|cost)|cost.*where/i, answer: analystConcentration },
    { when: /fatigue|burnout|risk.*cohort|cohort.*risk/i, answer: analystFatigue },
    { when: /leverage|highest|intervention|saving|addressable/i, answer: analystLeverage },
  ],
  coordinator: [
    { when: /cover gap|gap.*(hard|land)|where.*gap|90 days|ninety days/i, answer: coordinatorCoverGap },
    { when: /overtime|relief|roster load/i, answer: coordinatorOvertime },
    { when: /return to work|rtw|caseload/i, answer: coordinatorReturnToWork },
  ],
};

export function canAnswer(agent, question) {
  return (ANSWERS[agent] || []).some((a) => a.when.test(String(question || "")));
}

export function refusal(agent, suggested) {
  const list = (suggested || []).map((s) => `- ${s}`).join("\n");
  return [
    NOT_A_MODEL,
    "",
    "This deployment can answer the suggested questions below from the figures on screen. It cannot answer a question outside them, and a generic paragraph that read like an answer would be worse than saying so.",
    list ? `\n${list}` : "",
    "\nConfigure an agent key to ask this panel anything.",
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
