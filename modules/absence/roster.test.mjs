import { test } from "node:test";
import assert from "node:assert/strict";

import { checkRoster, parseRosterCsv, toMinutes, RULE_KEYS, SUPPRESSION_THRESHOLD } from "./roster.js";
import { rosterGroups, rosterToCsv, sampleRoster } from "./sampleRoster.js";

/*
  Each rule on hand-built shifts, at its boundary, because a rest rule that is
  off by an hour either cries wolf on every roster or misses the breaches it
  exists for. Then the privacy rules: no staff reference out, small departments
  suppressed, and identifying columns refused.
*/

// Five people in one department, so the department is reportable. Person A
// carries the pattern under test; the others work plain day shifts.
function roster(aShifts, { dept = "Dept", fillers = SUPPRESSION_THRESHOLD - 1 } = {}) {
  const shifts = aShifts.map(([start, end, extra = {}]) => ({ staff_ref: "A", department: dept, start, end, ...extra }));
  for (let i = 0; i < fillers; i++) {
    shifts.push({ staff_ref: `F${i}`, department: dept, start: "2026-11-03T09:00", end: "2026-11-03T17:00" });
  }
  return shifts;
}
const hits = (shifts, rule) => checkRoster(shifts).total.rules[rule].shifts;

test("times are read as written, whatever the clock's time zone", () => {
  assert.equal(toMinutes("2026-11-06T22:00") % (24 * 60), 22 * 60);
  assert.equal(toMinutes("2026-11-06 22:00"), toMinutes("2026-11-06T22:00"));
  assert.equal(toMinutes("6 Nov 22:00"), null);
  assert.equal(toMinutes("2026-13-06T22:00"), null);
});

test("daily rest: 11h59 between shifts is a breach, 12h is not", () => {
  assert.equal(hits(roster([["2026-11-02T14:00", "2026-11-02T22:01"], ["2026-11-03T10:00", "2026-11-03T18:00"]]), "daily_rest"), 1);
  assert.equal(hits(roster([["2026-11-02T14:00", "2026-11-02T22:00"], ["2026-11-03T10:00", "2026-11-03T18:00"]]), "daily_rest"), 0);
});

test("a meal break inside one day is not a daily-rest breach", () => {
  const split = roster([["2026-11-02T10:00", "2026-11-02T14:00"], ["2026-11-02T15:00", "2026-11-02T19:00"]]);
  assert.equal(hits(split, "daily_rest"), 0);
  assert.equal(hits(split, "split_shift"), 0, "a one-hour gap is a break, not a split");
});

test("a split shift is two shifts on one day with a gap of two hours or more", () => {
  assert.equal(hits(roster([["2026-11-02T10:00", "2026-11-02T14:00"], ["2026-11-02T16:00", "2026-11-02T21:00"]]), "split_shift"), 1);
});

test("late close then early open, including a close that runs past midnight", () => {
  assert.equal(hits(roster([["2026-11-02T16:00", "2026-11-02T23:00"], ["2026-11-03T07:00", "2026-11-03T15:00"]]), "late_then_early"), 1);
  assert.equal(hits(roster([["2026-11-02T18:00", "2026-11-03T01:00"], ["2026-11-03T08:00", "2026-11-03T16:00"]]), "late_then_early"), 1);
  assert.equal(hits(roster([["2026-11-02T16:00", "2026-11-02T23:00"], ["2026-11-03T10:00", "2026-11-03T18:00"]]), "late_then_early"), 0);
});

test("a run of late finishes is counted from the third in a row", () => {
  const lates = [2, 3, 4].map((d) => [`2026-11-0${d}T15:00`, `2026-11-0${d}T23:00`]);
  assert.equal(hits(roster(lates), "late_run"), 1);
  assert.equal(hits(roster(lates.slice(0, 2)), "late_run"), 0);
});

test("weekly rest: a full rest period counts even when it crosses midnight on Sunday", () => {
  // Works Mon to Sat, finishing Saturday 14:00, back Monday 06:00: 40 hours.
  const week = [2, 3, 4, 5, 6, 7].map((d) => [`2026-11-0${d}T06:00`, `2026-11-0${d}T14:00`]);
  assert.equal(hits(roster([...week, ["2026-11-09T06:00", "2026-11-09T14:00"]]), "weekly_rest"), 0);
  // Seven days straight, with a shift the Sunday before so the rest going into
  // the week is known: a breach. Without that shift the roster cannot say what
  // came before, and the check gives the benefit of the doubt.
  const seven = [2, 3, 4, 5, 6, 7, 8].map((d) => [`2026-11-0${d}T06:00`, `2026-11-0${d}T14:00`]);
  const before = ["2026-11-01T06:00", "2026-11-01T14:00"];
  const after = ["2026-11-09T06:00", "2026-11-09T14:00"];
  assert.ok(hits(roster([before, ...seven, after]), "weekly_rest") > 0);
  assert.equal(hits(roster([...seven, after]), "weekly_rest"), 0);
});

test("more than 45 hours in a week is flagged; exactly 45 is not", () => {
  const six = (len) => [2, 3, 4, 5, 6, 7].map((d) => [`2026-11-0${d}T08:00`, `2026-11-0${d}T${String(8 + len).padStart(2, "0")}:${len % 1 ? "30" : "00"}`]);
  assert.equal(hits(roster(six(7.5)), "weekly_hours"), 0);
  assert.equal(hits(roster(six(8)), "weekly_hours"), 6);
});

test("short notice: a change 47 hours before the start is flagged, 48 is not", () => {
  assert.equal(hits(roster([["2026-11-05T09:00", "2026-11-05T17:00", { changed_at: "2026-11-03T10:00" }]]), "short_notice"), 1);
  assert.equal(hits(roster([["2026-11-05T09:00", "2026-11-05T17:00", { changed_at: "2026-11-03T09:00" }]]), "short_notice"), 0);
});

// --- Privacy -------------------------------------------------------------------

test("no staff reference leaves the check", () => {
  const out = JSON.stringify(checkRoster(sampleRoster([{ label: "Dept", count: 50, mean_fatigue: 60 }])));
  assert.ok(!/"S\d{4}"/.test(out), "a staff reference appeared in the result");
  assert.ok(!out.includes("staff_ref"));
});

test("a department with fewer people than the threshold reports nothing, and is not in the totals", () => {
  const shifts = [
    ...roster([["2026-11-02T14:00", "2026-11-02T23:00"], ["2026-11-03T06:00", "2026-11-03T14:00"]], { dept: "Big" }),
    { staff_ref: "T1", department: "Tiny", start: "2026-11-02T14:00", end: "2026-11-02T23:00" },
    { staff_ref: "T1", department: "Tiny", start: "2026-11-03T06:00", end: "2026-11-03T14:00" },
  ];
  const r = checkRoster(shifts);
  const tiny = r.by_department.find((d) => d.label === "Tiny");
  assert.deepEqual(Object.keys(tiny).sort(), ["label", "suppressed", "suppressed_below"]);
  assert.equal(r.withheld_departments, 1);
  assert.equal(r.total.staff, 5, "the tiny department's person leaked into the totals");
  assert.equal(r.total.rules.daily_rest.shifts, 1);
});

test("a roster with identifying columns is refused, not cleaned", () => {
  const r = parseRosterCsv("staff_ref,name,department,start,end\nA,Thabo,Kitchen,2026-11-02T09:00,2026-11-02T17:00");
  assert.equal(r.refused, true);
  assert.equal(r.shifts.length, 0);
  assert.match(r.errors[0], /identify people/);
});

test("bad rows are reported by line, without echoing their contents", () => {
  const r = parseRosterCsv("staff_ref,department,start,end\nA,Dept,2026-11-02T09:00,2026-11-02T17:00\nB,Dept,yesterday,2026-11-02T17:00\nC,Dept,2026-11-02T17:00,2026-11-02T09:00");
  assert.equal(r.shifts.length, 1);
  assert.deepEqual(r.errors.map((e) => e.split(":")[0]), ["Line 3", "Line 4"]);
  assert.ok(!r.errors.join(" ").includes("yesterday"));
});

// --- The example roster ----------------------------------------------------------

test("the example roster is the same every time and round-trips through the CSV format", () => {
  const groups = [{ label: "Hot", count: 300, mean_fatigue: 70 }, { label: "Cool", count: 200, mean_fatigue: 45 }];
  const a = sampleRoster(groups);
  assert.deepEqual(a, sampleRoster(groups));
  const back = parseRosterCsv(rosterToCsv(a));
  assert.equal(back.errors.length, 0);
  assert.equal(back.shifts.length, a.length);
});

test("in the example, the higher-fatigue grouping has more late-then-early breaches", () => {
  const r = checkRoster(sampleRoster([{ label: "Hot", count: 300, mean_fatigue: 75 }, { label: "Cool", count: 300, mean_fatigue: 40 }]));
  const share = (label) => r.by_department.find((d) => d.label === label).rules.late_then_early.staff_share;
  assert.ok(share("Hot") > share("Cool"));
});

test("example groupings come from departments where the data has them, skipping suppressed rows", () => {
  const groups = rosterGroups({
    cohorts: {
      cohort_load: [{ label: "Load A", count: 100, mean_fatigue: 50 }],
      cohort_department: [{ label: "D1", count: 80, mean_fatigue: 60 }, { label: "D2", count: null, suppressed: true }],
    },
  });
  assert.deepEqual(groups.map((g) => g.label), ["D1"]);
});

test("every rule has a label, a source and a description", () => {
  const { rules } = checkRoster([]);
  assert.deepEqual(rules.map((r) => r.key), RULE_KEYS);
  for (const r of rules) assert.ok(r.label && r.source && r.description, r.key);
});
