import { test } from "node:test";
import assert from "node:assert/strict";

import { toolsFor, draftRecommendation, readCover, readCohorts } from "./agentTools.js";
import { runTool } from "../../lib/platform/agentTools.js";
import { ROLES } from "../../lib/platform/roles.js";
import { portfolio } from "./data/portfolio.js";

/*
  The absence module's tools, run through the platform's rules. These check the
  wiring: which agent gets which tool, that the tools read the server's data,
  and that what they return would pass the screen a real call goes through.
*/

const session = (role) => ({ email: `${role}@example.com`, role, permissions: ROLES[role].permissions });
const ctx = (role, extra = {}) => ({ portfolio, session: session(role), agent: "planner", trace: [], drafts: [], ...extra });
const use = (name, input = {}) => ({ type: "tool_use", id: "t1", name, input });

const draft = {
  kind: "roster_change",
  title: "Cap consecutive shifts for high-intensity operations",
  rationale: "The highest absence per head sits with the heaviest roster.",
  target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
  horizon: "season",
  predicted: { saving_rand: 250000, cost_rand: 40000, basis: "Scenario run on fewer consecutive shifts.", horizon_days: 90 },
};

test("only the planner can draft; the analyst reads", () => {
  assert.ok(toolsFor("planner").some((t) => t.name === "draft_recommendation"));
  assert.ok(!toolsFor("analyst").some((t) => t.name === "draft_recommendation"));
  assert.deepEqual(toolsFor("case"), []);
});

test("no tool approves anything", () => {
  for (const agent of ["analyst", "planner"]) {
    for (const t of toolsFor(agent)) assert.ok(!/approve|decide|book|send|dispatch/.test(t.name), t.name);
  }
});

test("every read tool's output passes the screen a live call goes through", () => {
  for (const t of toolsFor("analyst")) {
    const input = { read_cohorts: { dimension: "fatigue_band" }, read_demand: { grain: "week" } }[t.name] || {};
    const r = runTool([t], use(t.name, input), ctx("analyst"));
    assert.equal(r.is_error, undefined, `${t.name}: ${r.content}`);
  }
});

test("tools read the server's data, not whatever the request carried", () => {
  const r = runTool([readCover], use("read_cover"), ctx("analyst", { portfolio: undefined, body: { headline: { covered_lives: 1 } } }));
  assert.equal(r.is_error, true, "a tool answered without server-side data");
});

test("attendance measures never come back from the cover tool", () => {
  const r = runTool([readCover], use("read_cover"), ctx("analyst"));
  const { frequency_measures, ...data } = JSON.parse(r.content);
  assert.ok(!/bradford|freq_trigger/i.test(JSON.stringify(data)));
  assert.match(frequency_measures, /withheld/i);
});

test("a protected dimension is not a cohort view the tool offers", () => {
  const r = runTool([readCohorts], use("read_cohorts", { dimension: "age_band" }), ctx("analyst"));
  assert.equal(r.is_error, true);
});

test("a role that may create gets a draft, recorded against its session", () => {
  const c = ctx("prospect");
  const r = runTool([draftRecommendation], use("draft_recommendation", draft), c);
  assert.equal(r.is_error, undefined, r.content);
  assert.equal(c.drafts.length, 1);
  assert.equal(c.drafts[0].requested_by, "prospect@example.com");
  assert.equal(c.drafts[0].data_version, portfolio.run_name);
  assert.match(JSON.parse(r.content).next, /cannot approve/);
});

test("the approver role cannot draft, because approving is its whole job", () => {
  // Approver holds no USE_AGENTS either, so even reads are refused for it.
  const r = runTool([draftRecommendation], use("draft_recommendation", draft), ctx("approver"));
  assert.equal(r.is_error, true);
});

test("an invalid draft comes back with the reasons, so the model can fix it", () => {
  const bad = { ...draft, target: [{ dimension: "cohort_age", cohort: "Under 30" }], predicted: { ...draft.predicted, basis: "" } };
  const c = ctx("prospect");
  const r = runTool([draftRecommendation], use("draft_recommendation", bad), c);
  assert.equal(r.is_error, true);
  assert.match(r.content, /cannot be targeted/);
  assert.match(r.content, /basis is required/);
  assert.equal(c.drafts.length, 0);
});

test("read_cohorts hands back the key a draft targets with, so the model does not guess it", () => {
  const load = JSON.parse(runTool([readCohorts], use("read_cohorts", { dimension: "operational_load" }), ctx("analyst")).content);
  assert.equal(load.target_dimension, "cohort_load");
  const lifestyle = JSON.parse(runTool([readCohorts], use("read_cohorts", { dimension: "lifestyle_risk" }), ctx("analyst")).content);
  assert.equal(lifestyle.target_dimension, null, "lifestyle risk is readable but not targetable by default");
  assert.match(lifestyle.targeting, /not targeted/);
});

test("a draft built from read_cohorts' key passes, where the reading name was refused live", () => {
  const load = JSON.parse(runTool([readCohorts], use("read_cohorts", { dimension: "operational_load" }), ctx("analyst")).content);
  const c = ctx("prospect");
  const ok = runTool([draftRecommendation], use("draft_recommendation", { ...draft, target: [{ dimension: load.target_dimension, cohort: "High-intensity ops" }] }), c);
  assert.equal(ok.is_error, undefined, ok.content);
  const refused = runTool([draftRecommendation], use("draft_recommendation", { ...draft, target: [{ dimension: "operational_load", cohort: "High-intensity ops" }] }), ctx("prospect"));
  assert.equal(refused.is_error, true);
});

test("a tenant with no departments says so rather than returning an empty grouping as if it were data", () => {
  const r = JSON.parse(runTool([readCohorts], use("read_cohorts", { dimension: "department" }), ctx("analyst")).content);
  assert.equal(r.target_dimension, null);
  assert.match(r.targeting, /no such grouping/);
});

test("a tenant with departments gets them, with the key a draft targets them by", () => {
  const withDepartments = {
    ...portfolio,
    cohort_dimensions: [...portfolio.cohort_dimensions, { key: "cohort_department", label: "Department", protected: false, min_cohort: 5 }],
    cohorts: {
      ...portfolio.cohorts,
      cohort_department: [
        { key: "Dept A", label: "Dept A", count: 900, predicted_absent_days_annual: 9000, cost_exposure_rand: 5850000, addressable_saving_rand: 1, absent_days_per_head_annual: 10, high_or_critical_share: 0.1, mean_fatigue: 60 },
        { key: "Dept B", label: "Dept B", count: null, suppressed: true },
      ],
    },
  };
  const c = { ...ctx("prospect"), portfolio: withDepartments };
  const r = JSON.parse(runTool([readCohorts], use("read_cohorts", { dimension: "department" }), c).content);
  assert.equal(r.target_dimension, "cohort_department");
  assert.deepEqual(r.cohorts.map((x) => x.label), ["Dept A"], "the suppressed department is left out");
  const drafted = runTool([draftRecommendation], use("draft_recommendation", { ...draft, target: [{ dimension: "cohort_department", cohort: "Dept A" }] }), c);
  assert.equal(drafted.is_error, undefined, drafted.content);
});

test("read_demand says plainly when a tenant has no demand data", () => {
  const r = JSON.parse(runTool(toolsFor("analyst"), use("read_demand", { grain: "week" }), ctx("analyst")).content);
  assert.equal(r.available, false);
  assert.match(r.note, /no demand data/);
});

test("check_roster returns counts by department, never a staff reference, and says the roster is an example", () => {
  const r = runTool(toolsFor("analyst"), use("check_roster", {}), ctx("analyst"));
  assert.equal(r.is_error, undefined, r.content);
  assert.ok(!/"S\d{4}"/.test(r.content));
  const out = JSON.parse(r.content);
  assert.equal(out.available, true);
  assert.match(out.roster, /Example roster/);
  assert.ok(out.by_department.length > 0);
});


test("a draft must say its horizon, and the horizon must match its days", () => {
  const c = ctx("analyst");
  const { horizon, ...noHorizon } = draft;
  const missing = runTool([draftRecommendation], use("draft_recommendation", noHorizon), c);
  assert.equal(missing.is_error, true, "a draft without a horizon was accepted");
  const wrong = runTool([draftRecommendation], use("draft_recommendation", { ...draft, horizon: "week" }), c);
  assert.equal(wrong.is_error, true);
  assert.match(wrong.content, /next week proposal runs 1 to 14 days/i);
  const ok = runTool(
    [draftRecommendation],
    use("draft_recommendation", { ...draft, horizon: "week", predicted: { ...draft.predicted, horizon_days: 7 } }),
    c,
  );
  assert.equal(JSON.parse(ok.content).status, "Drafted");
  assert.equal(c.drafts.at(-1).horizon, "week");
});
