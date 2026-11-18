/*
  The absence module's agent tools.

  The read tools return the same allow-listed figures the grounding builders in
  context.js produce, so a tool cannot hand the model a field the panels would
  not. The difference is where the data comes from: the builders here run over
  the module data on the server, passed in as ctx.portfolio by the route, not
  over a payload the browser sent.

  Which agent gets which tools is decided here too. The analyst reads. The
  coordinator reads and may draft a recommendation, because cover and roster
  actions are its job. Neither can approve anything: there is no approving
  tool, by design, and the drafting tool's output says a person decides.
*/

import { defineTool } from "../../lib/platform/agentTools.js";
import { PERMISSIONS } from "../../lib/platform/roles.js";
import { buildAnalystContext, buildCoordinatorContext } from "./context.js";
import { buildRecommendation, KIND_KEYS, MAX_HORIZON_DAYS, trackRecord } from "../control-centre/recommendations.js";
import { TARGETABLE_BY_DEFAULT } from "../control-centre/targeting.js";

/*
  Each readable grouping, with the dimension key a recommendation targets it
  by. The reading names and the targeting keys differ, and in the first live
  run the model drafted against the reading name ("operational_load") and was
  refused. read_cohorts now hands back the key to use, or says the grouping
  cannot be targeted, so a draft starts from the right word.
*/
const COHORT_VIEWS = {
  operational_load: { view: "cohorts_by_operational_load", target: "cohort_load" },
  fatigue_band: { view: "cohorts_by_fatigue_band", target: "cohort_fatigue" },
  lifestyle_risk: { view: "cohorts_by_lifestyle_risk", target: "cohort_lifestyle" },
  department: { view: "cohorts_by_department", target: "cohort_department" },
};

function portfolioOf(ctx) {
  if (!ctx?.portfolio) throw new Error("No module data is loaded on the server.");
  return ctx.portfolio;
}

export const readPortfolio = defineTool({
  name: "read_portfolio",
  description:
    "Headline figures for the covered workforce: covered lives, predicted absent days, cost exposure, addressable saving, risk distribution and fatigue summary. Cohort level only, modelled not measured.",
  permission: PERMISSIONS.USE_AGENTS,
  run: (_input, ctx) => {
    const a = buildAnalystContext(portfolioOf(ctx));
    return {
      note: a.note,
      suppression: a.suppression,
      headline: a.headline,
      risk_distribution: a.risk_distribution,
      fatigue_summary: a.fatigue_summary,
      addressable_saving_basis: a.addressable_saving_basis,
    };
  },
});

export const readCohorts = defineTool({
  name: "read_cohorts",
  description:
    "Cohort figures for one dimension: headcount, predicted absent days, cost exposure, addressable saving, high or critical share and mean fatigue. Suppressed cohorts are left out and counted.",
  permission: PERMISSIONS.USE_AGENTS,
  input_schema: {
    type: "object",
    properties: {
      dimension: { type: "string", enum: Object.keys(COHORT_VIEWS), description: "Which grouping to read." },
    },
    required: ["dimension"],
    additionalProperties: false,
  },
  run: ({ dimension }, ctx) => {
    const a = buildAnalystContext(portfolioOf(ctx));
    const { view, target } = COHORT_VIEWS[dimension];
    if (!Array.isArray(a[view])) {
      return { dimension, target_dimension: null, targeting: "This tenant's data has no such grouping.", cohorts: [] };
    }
    const targetable = TARGETABLE_BY_DEFAULT.includes(target);
    return {
      dimension,
      target_dimension: targetable ? target : null,
      targeting: targetable
        ? `To target one of these cohorts in draft_recommendation, use dimension "${target}" and the cohort label.`
        : "These cohorts can be read but not targeted by a recommendation.",
      suppression: a.suppression,
      cohorts: a[view],
    };
  },
});

export const readCover = defineTool({
  name: "read_cover",
  description:
    "Operational cover figures: predicted cover-gap days and cover cost over 90 days, overtime load, return-to-work caseload, by operational-load cohort and, where the tenant has them, by department, with the day rate and cover assumptions they rest on. Attendance-frequency measures are not available.",
  permission: PERMISSIONS.USE_AGENTS,
  run: (_input, ctx) => buildCoordinatorContext(portfolioOf(ctx)),
});

export const readTrackRecord = defineTool({
  name: "read_track_record",
  description:
    "How past recommendations turned out: how many closed, predicted against delivered savings, and how many were approved or rejected. Says when there are too few to judge.",
  permission: PERMISSIONS.USE_AGENTS,
  run: (_input, ctx) => trackRecord(ctx.recommendations || []),
});

export const draftRecommendation = defineTool({
  name: "draft_recommendation",
  description:
    "Draft one priced action for a person to approve or reject. Target cohorts, never people. State what it saves, what it costs, how the saving was worked out and over how many days. The draft is not approved, booked or sent.",
  permission: PERMISSIONS.CONTROL_CREATE,
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: KIND_KEYS },
      title: { type: "string" },
      rationale: { type: "string" },
      target: {
        type: "array",
        description: `One or two cohorts, each { dimension, cohort }. dimension is one of: ${TARGETABLE_BY_DEFAULT.join(", ")} (read_cohorts returns the one to use as target_dimension). e.g. { dimension: 'cohort_load', cohort: 'High-intensity ops' }.`,
        items: {
          type: "object",
          properties: { dimension: { type: "string" }, cohort: { type: "string" } },
          required: ["dimension", "cohort"],
        },
      },
      predicted: {
        type: "object",
        description: `saving_rand and cost_rand in Rand, basis in words, horizon_days from 1 to ${MAX_HORIZON_DAYS}.`,
        properties: {
          saving_rand: { type: "number" },
          cost_rand: { type: "number" },
          basis: { type: "string" },
          horizon_days: { type: "integer" },
        },
        required: ["saving_rand", "cost_rand", "basis", "horizon_days"],
      },
    },
    required: ["kind", "title", "rationale", "target", "predicted"],
    additionalProperties: false,
  },
  run: (input, ctx) => {
    const portfolio = portfolioOf(ctx);
    const rec = buildRecommendation(
      input,
      {
        agent: ctx.agent,
        requestedBy: ctx.session?.email,
        dataVersion: portfolio.run_name,
        trace: ctx.trace,
      },
      { dimensions: portfolio.cohort_dimensions, cohorts: portfolio.cohorts },
    );
    if (Array.isArray(ctx.drafts)) ctx.drafts.push(rec);
    return {
      id: rec.id,
      status: rec.status,
      net_rand: rec.predicted.net_rand,
      next: "Drafted only. A person with approval rights decides; the requester cannot approve it.",
    };
  },
});

const READ_TOOLS = [readPortfolio, readCohorts, readCover, readTrackRecord];

/*
  `canDraft` is whether this tenant has somewhere to put a draft: the control
  centre. With it off, the coordinator still reads and advises, and the model is
  never offered a tool whose output would go nowhere.
*/
export function toolsFor(agent, { canDraft = true } = {}) {
  if (agent === "coordinator") return canDraft ? [...READ_TOOLS, draftRecommendation] : READ_TOOLS;
  if (agent === "analyst") return READ_TOOLS;
  return [];
}
