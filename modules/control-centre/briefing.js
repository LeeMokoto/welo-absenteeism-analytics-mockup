/*
  The briefing: what happened, what needs a person, and what is still unknown.

  The control centre accumulates state across four screens, and nobody opens
  four screens. A briefing is the one artefact that answers "what do I need to
  do" without being asked, which is also what makes it the easiest thing in the
  product to get wrong.

  Three rules it keeps, and the third is the one that matters.

  **It is a reading artefact, so it inherits every reporting rule.** Cohort
  level, suppression respected, no individual anywhere. It composes figures the
  screens already publish rather than reaching into the data itself, so a
  cohort withheld on a screen is withheld here.

  **It never upgrades an observation into a claim.** The outcome section carries
  the same caveat the register carries, in full, not a shortened version. A
  briefing is forwarded, pasted into an email and read by people who never saw
  the screen it came from, so the caveat has to travel inside it.

  **It leads with what needs a decision, not with what looks good.** A digest
  that opens with the improvement and buries the three plans awaiting approval
  is a digest that trains people to skim it. The decisions come first, the
  measurements come after, and if there is nothing to decide it says that
  rather than padding.

  It is deliberately not a push. Nothing here sends anything: it renders on a
  screen, and the one thing in this product that leaves is an outbound task,
  which has its own gate. A briefing that emailed itself would be a second
  outbound path with none of those controls.
*/

import { evaluateAll } from "./alerts.js";
import { blockers as outcomeBlockers, measureOutcome, summarise } from "./outcomes.js";
import { approvalBlockers } from "./playbooks.js";
import { horizonLabel, trackRecord } from "./recommendations.js";

const daysBetween = (from, to) => {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
};

/*
  Build the briefing.

  Everything comes in as already-published data: the register, the playbooks,
  the rules, the cohort figures and the monthly series. Nothing is fetched and
  nothing is recomputed from a richer source, which is what keeps the briefing
  unable to say more than the screens do.
*/
export function buildBriefing({
  interventions = [],
  playbooks = [],
  rules = [],
  tasks = [],
  dimensions = [],
  cohorts = {},
  series = null,
  suppressionThreshold = 5,
  asOf = new Date().toISOString().slice(0, 10),
  tenant = null,
  // The agents' proposals, examples and this browser's own.
  proposals = [],
  // Finished proposals as the Reviewer measured them (review.js).
  measurements = [],
  // The Planner's triggers (plannerTriggers.js), worked out on the server.
  triggers = [],
  // The staffing cost headline (staffingCost.js summary), where the tenant
  // has one, and its 90-day value at risk by department.
  staffingCost = null,
  riskByDepartment = [],
} = {}) {
  /* --- Needs a person ---------------------------------------------------- */

  const awaitingDecision = playbooks
    .filter((p) => !p.approval && p.status !== "Rejected" && p.status !== "Superseded")
    .map((p) => {
      const intervention = interventions.find((i) => i.id === p.intervention_id) || null;
      return {
        id: p.id,
        title: p.title,
        intervention: intervention?.title || null,
        drafted_at: p.drafted_at,
        drafted_by_role: p.drafted_by_role,
        drafted_with: p.drafted_with,
        waiting_days: daysBetween(p.drafted_at, asOf),
        // The reason it is still waiting is worth carrying: "waiting for an
        // approver" and "waiting because the only approver drafted it" are
        // different problems with different fixes.
        note:
          approvalBlockers(p, { email: p.drafted_by, role: p.drafted_by_role }, {
            hasApprovePermission: true,
            storeCanDecide: p.source !== "seeded",
          }).find((b) => b.includes("drafter")) || null,
      };
    })
    .sort((a, b) => (b.waiting_days || 0) - (a.waiting_days || 0));

  const approvedNotSent = playbooks
    .filter((p) => p.status === "Approved")
    .flatMap((p) =>
      (p.steps || [])
        .filter((s) => !tasks.some((t) => t.playbook_id === p.id && t.instruction === String(s.action || "").trim() && t.status !== "Cancelled"))
        .map((s) => ({ playbook: p.title, playbook_id: p.id, owner: s.owner, horizon: s.horizon })),
    );

  /* --- Proposals waiting on a person ---------------------------------------- */
  const proposalsAwaiting = (proposals || [])
    .filter((r) => r.status === "Drafted")
    .map((r) => ({
      id: r.id,
      title: r.title,
      horizon: horizonLabel(r.horizon),
      net_rand: r.predicted?.net_rand ?? null,
      waiting_days: daysBetween(r.created, asOf),
    }))
    .sort((a, b) => (b.waiting_days || 0) - (a.waiting_days || 0));
  const outcomesAwaiting = (measurements || []).map((m) =>
    m.ok
      ? {
          id: m.proposal.id,
          title: m.proposal.title,
          cohort: m.cohort.cohort,
          predicted_saving_rand: m.predicted_saving_rand,
          measured_saving_rand: m.measured_saving_rand,
          delivered_share: m.delivered_share,
          shortfall_rand: m.shortfall_rand,
        }
      : { id: m.id, title: m.title, reasons: m.reasons },
  );

  /* --- What the rules noticed -------------------------------------------- */

  const ruleResults = evaluateAll(rules.filter((r) => r.enabled !== false), {
    cohorts,
    suppressionThreshold,
  });
  // evaluateAll returns [{ rule, result }], so the firing rows are one level
  // down. Reading r.firing instead gave an empty list and a briefing that said
  // nothing was firing while a rule was.
  const firing = [];
  let skippedTotal = 0;
  for (const { rule, result } of ruleResults || []) {
    for (const f of result?.firing || []) {
      firing.push({
        rule: rule?.name || null,
        cohort: f.cohort,
        value: f.value,
        count: f.count,
        measure: rule?.measure || null,
      });
    }
    skippedTotal += (result?.skipped || []).length;
  }

  /* --- What has been measured -------------------------------------------- */

  const measured = [];
  const notYetMeasurable = [];
  for (const i of interventions) {
    const why = series ? outcomeBlockers(i, series) : ["no cohort series has been published"];
    if (why.length) {
      notYetMeasurable.push({ id: i.id, title: i.title, reasons: why });
      continue;
    }
    const outcome = measureOutcome(i, series);
    const said = summarise(outcome);
    if (said) {
      measured.push({
        id: i.id,
        title: i.title,
        cohort: outcome.cohort,
        direction: said.direction,
        raw: said.raw,
        context: said.context,
        headline: said.headline,
        // Carried in full. A briefing is forwarded and pasted, so the caveat
        // travels inside it rather than being left on the screen it came from.
        caveat: said.caveat,
        provenance: said.provenance,
      });
    }
  }

  /* --- What is running --------------------------------------------------- */

  const byStatus = {};
  for (const i of interventions) byStatus[i.status] = (byStatus[i.status] || 0) + 1;

  const sent = tasks.filter((t) => t.status !== "Cancelled");

  /* --- Risk ahead ------------------------------------------------------- */
  const fired = (triggers || []).filter((t) => t.fired);
  const risk = {
    triggers_fired: fired.map((t) => ({ label: t.label, reason: t.reason, horizon: horizonLabel(t.horizon) })),
    value_at_risk_90d: staffingCost?.next_90_days?.value_at_risk_rand || null,
    from: staffingCost?.next_90_days?.from || null,
    to: staffingCost?.next_90_days?.to || null,
    by_department: (riskByDepartment || [])
      .filter((d) => d.value_at_risk_rand)
      .map((d) => ({ label: d.label, value_at_risk_rand: d.value_at_risk_rand }))
      .sort((a, b) => b.value_at_risk_rand.mid - a.value_at_risk_rand.mid),
    note: staffingCost
      ? "Value at risk is cover the coming gaps will need plus the revenue they will lose, a forecast and a range. By department: property is not a reporting dimension in this tenant's data yet."
      : null,
  };
  const record = trackRecord(proposals || []);

  return {
    as_of: asOf,
    tenant: tenant ? { name: tenant.name, environment: tenant.environment, synthetic: tenant.synthetic } : null,
    suppression_threshold: suppressionThreshold,

    // Decisions first, by design. See the header.
    decisions: {
      playbooks_awaiting_approval: awaitingDecision,
      approved_steps_not_yet_sent: approvedNotSent,
      proposals_awaiting_decision: proposalsAwaiting,
      // Finished proposals whose outcome a person has not yet recorded, with
      // what the Reviewer measured.
      outcomes_awaiting_record: outcomesAwaiting,
      count: awaitingDecision.length + approvedNotSent.length + proposalsAwaiting.length + outcomesAwaiting.length,
    },
    risk,

    attention: {
      rules_firing: firing,
      cohorts_skipped_by_rules: skippedTotal,
      // Said explicitly, because a rule that skipped a cohort it could not
      // report on looks exactly like a rule that found nothing.
      skipped_note:
        skippedTotal > 0
          ? `${skippedTotal} cohort${skippedTotal === 1 ? "" : "s"} could not be evaluated because they are under the reporting threshold. Silence on those is not safety.`
          : null,
    },

    outcomes: {
      measured,
      not_yet_measurable: notYetMeasurable,
    },
    proposals: {
      // Approved and still within its horizon: not among the finished ones.
      running: (proposals || []).filter(
        (r) => r.status === "Approved" && !outcomesAwaiting.some((o) => o.id === r.id),
      ).length,
      track_record: {
        closed: record.closed,
        enough: record.enough,
        summary: record.summary,
      },
      caveat: outcomesAwaiting.length
        ? "Measured savings are an observed difference against comparable cohorts frozen at approval, not a proven cause."
        : null,
    },

    activity: {
      interventions_by_status: byStatus,
      interventions_total: interventions.length,
      playbooks_total: playbooks.length,
      tasks_recorded: sent.length,
      tasks_note: sent.length
        ? "Recorded, not sent. This tenant has no outbound integration."
        : null,
    },

    // What this briefing is, inside the briefing. It gets forwarded.
    footer: {
      level: "Every figure is at cohort level. Cohorts under the threshold are withheld and no total is published for them.",
      not_a_decision:
        "This is a summary of what the platform recorded. It decides nothing: a plan is approved by a person, and POPIA section 71 restricts decisions based solely on automated processing.",
      dimensions: (dimensions || []).map((d) => d.label),
    },
  };
}

/*
  The one-line version, for the top of a screen or the subject of an email
  somebody writes by hand.

  Leads with the count of things needing a person. If that is zero it says so
  plainly rather than finding something cheerful to lead with.
*/
export function headline(briefing) {
  if (!briefing) return null;
  const d = briefing.decisions?.count || 0;
  const f = (briefing.attention?.rules_firing || []).length;
  const m = (briefing.outcomes?.measured || []).length;
  const t = (briefing.risk?.triggers_fired || []).length;

  const parts = [];
  parts.push(
    d === 0
      ? "Nothing is waiting on a decision"
      : `${d} thing${d === 1 ? "" : "s"} waiting on a person`,
  );
  if (t) parts.push(`${t} planning trigger${t === 1 ? "" : "s"} due`);
  if (f) parts.push(`${f} alert rule${f === 1 ? "" : "s"} firing`);
  if (m) parts.push(`${m} intervention${m === 1 ? "" : "s"} now measurable`);
  return parts.join(", ") + ".";
}
