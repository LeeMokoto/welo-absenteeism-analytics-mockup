import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  dateLabel,
  departmentNames,
  departmentView,
  hasStaffingCost,
  isRange,
  monthLabel,
  summary,
  timeline,
} from "./staffingCost.js";
import { PERSON_KEYS, runTool } from "../../lib/platform/agentTools.js";
import { toolsFor } from "./agentTools.js";
import { ROLES } from "../../lib/platform/roles.js";

/*
  The staffing cost block, read from the hospitality feed the model builds.
  These hold the reading rules: estimates stay ranges all the way to the agent,
  the forecast never passes as history, unpriced departments stay unpriced, and
  no figure anywhere is keyed by person.
*/

const FEED = fileURLToPath(new URL("../../model/data/outputs/dashboard_feed.hospitality.json", import.meta.url));
const feed = existsSync(FEED) ? JSON.parse(readFileSync(FEED, "utf8")) : null;
const block = feed?.staffing_cost;
const skip = !block && "hospitality feed not built";

function keysDeep(node, out = []) {
  if (Array.isArray(node)) node.forEach((v) => keysDeep(v, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

const use = (name, input) => ({ type: "tool_use", id: "t1", name, input });
const session = (role) => ({ email: `${role}@example.com`, role, permissions: ROLES[role].permissions });
const ctx = (portfolio) => ({ portfolio, session: session("analyst"), agent: "analyst", trace: [], drafts: [] });

test("the hospitality feed carries a staffing cost block", { skip }, () => {
  assert.ok(hasStaffingCost({ staffing_cost: block }));
  assert.equal(block.measure.indicative, true);
});

test("no figure in the block is keyed by person", { skip }, () => {
  const keys = new Set(keysDeep(block).map((k) => k.toLowerCase()));
  for (const k of PERSON_KEYS) assert.ok(!keys.has(k), `person key ${k} in the staffing cost block`);
});

test("the timeline runs history then forecast, and never mixes them", { skip }, () => {
  const rows = timeline(block);
  assert.equal(rows.length, block.history.length + block.forecast.months.length);
  const firstForecast = rows.findIndex((r) => r.kind === "forecast");
  assert.equal(firstForecast, block.history.length);
  assert.ok(rows.slice(firstForecast).every((r) => r.kind === "forecast"));
  for (const r of rows) {
    assert.ok(isRange(r.lost_revenue_rand) && isRange(r.cover_spend_rand) && isRange(r.total_rand));
    assert.ok(r.total_rand.low <= r.total_rand.mid && r.total_rand.mid <= r.total_rand.high);
  }
});

test("history cover spend is a single paid figure; forecast cover is a range", { skip }, () => {
  for (const r of timeline(block)) {
    const c = r.cover_spend_rand;
    if (r.kind === "history") assert.ok(c.low === c.mid && c.mid === c.high);
    else assert.ok(c.low < c.high);
  }
});

test("the summary keeps estimates as ranges and compares a gap with its cover", { skip }, () => {
  const s = summary(block);
  assert.ok(Number.isFinite(s.last_12_months.cover_spend_rand));
  assert.ok(isRange(s.last_12_months.lost_revenue_rand));
  assert.ok(isRange(s.next_90_days.value_at_risk_rand));
  assert.ok(isRange(s.lost_revenue_per_short_shift_rand));
  assert.equal(s.cover_rate_per_shift_rand, block.assumptions.cover_rate_per_shift_rand);
  assert.equal(typeof s.cover_pays, "boolean");
});

test("unpriced departments stay unpriced, with a counted indicator", { skip }, () => {
  const unpriced = block.by_department.filter((d) => !d.priced);
  assert.ok(unpriced.length > 0);
  for (const d of unpriced) {
    assert.equal(d.lost_revenue_rand, undefined);
    assert.equal(d.indicator.unpriced, true);
  }
});

test("a department view is that department or nothing", { skip }, () => {
  const name = departmentNames(block)[0];
  assert.equal(departmentView(block, name).label, name);
  assert.equal(departmentView(block, "Not a department"), null);
  assert.equal(departmentView(block, ""), null);
});

test("months are labelled without a time zone moving them", () => {
  assert.equal(monthLabel("2026-01"), "Jan 2026");
  assert.equal(monthLabel("2025-12", { short: true }), "Dec");
  assert.equal(monthLabel("nonsense"), "nonsense");
  assert.equal(dateLabel("2027-01-29"), "29 Jan 2027");
});

test("a tenant without the block gets the empty state, not a crash", () => {
  assert.equal(hasStaffingCost({}), false);
  assert.equal(hasStaffingCost({ staffing_cost: { history: [] } }), false);
  assert.deepEqual(timeline(null), []);
  assert.equal(summary(null), null);
});

test("both agents can read the staffing cost", () => {
  for (const agent of ["analyst", "planner"]) {
    assert.ok(toolsFor(agent).some((t) => t.name === "read_staffing_cost"), agent);
  }
});

test("read_staffing_cost returns ranges and the method, with no person in it", { skip }, () => {
  const r = JSON.parse(runTool(toolsFor("analyst"), use("read_staffing_cost", {}), ctx({ staffing_cost: block })).content);
  assert.equal(r.available, true);
  assert.ok(isRange(r.next_90_days.value_at_risk_rand));
  assert.ok(isRange(r.last_12_months.lost_revenue_rand));
  assert.ok(r.basis.method && r.basis.note);
  const keys = new Set(keysDeep(r).map((k) => k.toLowerCase()));
  for (const k of PERSON_KEYS) assert.ok(!keys.has(k), k);
});

test("read_staffing_cost reads one department, and refuses an unknown one", { skip }, () => {
  const name = departmentNames(block)[0];
  const one = JSON.parse(runTool(toolsFor("analyst"), use("read_staffing_cost", { department: name }), ctx({ staffing_cost: block })).content);
  assert.equal(one.department.label, name);
  const bad = JSON.parse(runTool(toolsFor("analyst"), use("read_staffing_cost", { department: "Nowhere" }), ctx({ staffing_cost: block })).content);
  assert.equal(bad.available, false);
});

test("read_staffing_cost says plainly when a tenant has none", () => {
  const r = JSON.parse(runTool(toolsFor("analyst"), use("read_staffing_cost", {}), ctx({})).content);
  assert.equal(r.available, false);
});
