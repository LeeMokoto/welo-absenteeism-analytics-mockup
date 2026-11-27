import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  THRESHOLD,
  hasThresholds,
  monthlyTrigger,
  plannerTriggers,
  thresholdTriggers,
  weeklyTrigger,
} from "./plannerTriggers.js";
import { HORIZON_KEYS } from "../control-centre/recommendations.js";

/*
  When the Planner is due, and about what. The tests pin the calendar (a
  Monday to Thursday window before the roster goes out, the turn of a month)
  and the threshold (fires above its own recent average, never below).
*/

const FEED = fileURLToPath(new URL("../../model/data/outputs/dashboard_feed.hospitality.json", import.meta.url));
const hospitality = existsSync(FEED) ? JSON.parse(readFileSync(FEED, "utf8")) : null;
const skip = !hospitality && "hospitality feed not built";
const day = (s) => new Date(`${s}T09:00:00Z`);

test("weekly: due Monday to Thursday, about the week the roster covers", () => {
  for (const d of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]) {
    const t = weeklyTrigger(day(d));
    assert.equal(t.fired, true, d);
    assert.match(t.question, /week of Monday 30 November/);
  }
  for (const d of ["2026-11-27", "2026-11-28", "2026-11-29"]) {
    assert.equal(weeklyTrigger(day(d)).fired, false, d);
  }
  assert.equal(weeklyTrigger(day("2026-11-24")).horizon, "week");
});

test("monthly: due around the turn of the month, about the month ahead", () => {
  const late = monthlyTrigger(day("2026-11-25"));
  assert.equal(late.fired, true);
  assert.match(late.question, /December 2026/);
  const early = monthlyTrigger(day("2026-12-02"));
  assert.equal(early.fired, true);
  assert.match(early.reason, /has just started/);
  assert.equal(monthlyTrigger(day("2026-12-12")).fired, false);
  assert.equal(late.horizon, "month");
});

test("every trigger carries a horizon the drafting tool accepts", { skip }, () => {
  for (const t of plannerTriggers(hospitality, { today: day("2026-11-24") })) {
    assert.ok(HORIZON_KEYS.includes(t.horizon), t.id);
    assert.ok(t.question && t.reason && t.label, t.id);
  }
});

test("threshold: fires only where the forecast runs above its own recent average", { skip }, () => {
  const fired = thresholdTriggers(hospitality.staffing_cost, { today: day("2026-11-24") });
  assert.ok(fired.length > 0, "the hospitality forecast has a December peak and should fire");
  for (const t of fired) assert.ok(t.ratio > THRESHOLD, t.id);
  // Raise the bar past every ratio and nothing fires.
  const top = Math.max(...fired.map((t) => t.ratio));
  assert.deepEqual(thresholdTriggers(hospitality.staffing_cost, { threshold: top + 0.01, today: day("2026-11-24") }), []);
});

test("threshold: a forecast month already over does not fire", { skip }, () => {
  const later = thresholdTriggers(hospitality.staffing_cost, { today: day("2027-02-10") });
  assert.ok(later.every((t) => !/December 2026|January 2027/.test(t.label)));
});

test("a tenant with no cost forecast has schedule triggers only", () => {
  assert.equal(hasThresholds({}), false);
  const t = plannerTriggers({}, { today: day("2026-11-24") });
  assert.deepEqual(t.map((x) => x.kind).sort(), ["schedule", "schedule"]);
});

test("fired triggers come first", { skip }, () => {
  const t = plannerTriggers(hospitality, { today: day("2026-11-28") });
  const firstUnfired = t.findIndex((x) => !x.fired);
  if (firstUnfired >= 0) assert.ok(t.slice(firstUnfired).every((x) => !x.fired));
});
