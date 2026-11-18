import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GRAINS, demandView, departmentLabels, hasDemand } from "./demand.js";
import { runTool } from "../../lib/platform/agentTools.js";
import { readDemand } from "./agentTools.js";
import { ROLES } from "../../lib/platform/roles.js";

/*
  The demand block, read from the hospitality feed the model builds. These hold
  the reading rules: a view is one department or the whole workforce, never a
  silent fallback from one to the other; pressure points come from the data;
  and the benchmark caveat travels with the figures to the agent.
*/

const FEED = fileURLToPath(new URL("../../model/data/outputs/dashboard_feed.hospitality.json", import.meta.url));
const feed = existsSync(FEED) ? JSON.parse(readFileSync(FEED, "utf8")) : null;
const demand = feed?.demand;
const skip = !demand && "hospitality feed not built";

test("the hospitality feed carries a demand block", { skip }, () => {
  assert.ok(hasDemand({ demand }));
  assert.ok(departmentLabels(demand).length >= 4);
  assert.equal(demand.measure.indicative, true);
});

test("every view has one row per period, in calendar order", { skip }, () => {
  for (const grain of GRAINS) {
    const v = demandView(demand, grain);
    assert.deepEqual(v.rows.map((r) => r.label), demand.labels[grain]);
    for (const r of v.rows) {
      assert.ok(r.demand > 0 && r.demand <= 1, `${grain} ${r.label} demand ${r.demand}`);
      assert.ok(r.absence_rate > 0 && r.absence_rate < 0.5);
    }
  }
});

test("pressure points are where demand is near its peak and absence above average", { skip }, () => {
  for (const grain of GRAINS) {
    const v = demandView(demand, grain);
    for (const r of v.rows) {
      if (r.pressure) {
        assert.ok(r.demand >= 0.8, `${grain} ${r.label}`);
        assert.ok(r.absence_rate >= v.absence_rate_annual, `${grain} ${r.label}`);
      }
    }
  }
  assert.ok(demandView(demand, "week").pressure.length > 0, "the week should have at least one pressure point");
});

test("an unknown department returns nothing rather than another department's figures", { skip }, () => {
  assert.equal(demandView(demand, "week", "No such department"), null);
  assert.equal(demandView(demand, "fortnight"), null);
});

test("departments see their own pattern, not the workforce's", { skip }, () => {
  const labels = departmentLabels(demand);
  const views = labels.map((d) => JSON.stringify(demandView(demand, "day", d).rows.map((r) => r.demand)));
  assert.ok(new Set(views).size > 1, "every department had the same day pattern");
});

test("a tenant without departments has no demand view", () => {
  assert.equal(hasDemand({}), false);
  assert.equal(hasDemand({ demand: null }), false);
});

test("the agent's demand reading carries the benchmark caveat with it", { skip }, () => {
  const session = { email: "a@example.com", role: "analyst", permissions: ROLES.analyst.permissions };
  const r = runTool([readDemand], { type: "tool_use", id: "t", name: "read_demand", input: { grain: "week" } }, {
    portfolio: { ...feed, demand },
    session,
  });
  assert.equal(r.is_error, undefined, r.content);
  const out = JSON.parse(r.content);
  assert.equal(out.available, true);
  assert.equal(out.basis.indicative, true);
  assert.ok(out.pressure.length > 0);
});
