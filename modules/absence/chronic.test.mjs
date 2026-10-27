import { test } from "node:test";
import assert from "node:assert/strict";

import { CHRONIC_COHORT_KEYS, CHRONIC_SOURCE, chronic, chronicColumns } from "./data/chronic.js";
import { portfolio } from "./data/portfolio.js";

/*
  The chronic panel shows health data that is not this tenant's, keyed to
  cohorts that can be suppressed. Both halves of that sentence are a way to
  mislead somebody, so these tests are about the data and the contract the
  screen depends on rather than about rendering.

  The component itself is JSX and is checked in the browser pass; what is
  checked here is everything the component cannot fix at render time: whether
  the benchmark's keys still line up with the feed, whether a percentage is
  still a percentage, and whether the labelling that makes this panel honest is
  still present in the module contract.
*/

// --- The benchmark lines up with the feed it is drawn over -----------------

test("every benchmark column names a cohort the feed actually has", () => {
  /*
    The failure this prevents: a cohort renamed upstream, the component looking
    it up, finding nothing, and the grid silently losing a column. The screen
    does say when that happens, but it should never happen without this test
    going red first, in the repository rather than in front of a prospect.
  */
  const feedKeys = new Set((portfolio.cohorts?.cohort_load || []).map((c) => c.key));
  for (const key of CHRONIC_COHORT_KEYS) {
    assert.ok(feedKeys.has(key), `benchmark column "${key}" has no cohort in the feed`);
  }
});

test("every row carries a value for every column, so no cell is invented at render", () => {
  for (const row of chronic.rows) {
    for (const key of CHRONIC_COHORT_KEYS) {
      const v = row.byCohort[key];
      assert.equal(typeof v, "number", `${row.condition} has no number for ${key}`);
    }
  }
});

test("the operational-load cohorts are the ones the panel is keyed to, in feed order", () => {
  // Order is not what the component relies on, it looks each key up. This
  // asserts the two have not drifted apart conceptually, which is what would
  // make somebody "fix" the component by trusting order again.
  const feedOrder = (portfolio.cohorts?.cohort_load || []).map((c) => c.key);
  assert.deepEqual(CHRONIC_COHORT_KEYS, feedOrder);
});

// --- A percentage is a percentage ------------------------------------------

test("no prevalence is outside nought to one hundred", () => {
  for (const row of chronic.rows) {
    for (const [key, v] of Object.entries(row.byCohort)) {
      assert.ok(v >= 0 && v <= 100, `${row.condition} / ${key} is ${v}`);
    }
    assert.ok(row.workforce >= 0 && row.workforce <= 100, `${row.condition} workforce is ${row.workforce}`);
  }
});

test("the workforce figure sits inside the range of its cohorts", () => {
  /*
    It is carried from the benchmark rather than averaged, deliberately, so it
    is not asserted to equal any particular mean. But a whole-workforce figure
    outside the span of its own columns is a transcription error, and it would
    read as a fourth cohort that is worse than all three.
  */
  for (const row of chronic.rows) {
    const vs = Object.values(row.byCohort);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    assert.ok(
      row.workforce >= lo && row.workforce <= hi,
      `${row.condition}: workforce ${row.workforce} is outside its cohorts ${lo}-${hi}`,
    );
  }
});

test("conditions are distinct, so no row can be read twice", () => {
  const names = chronic.rows.map((r) => r.condition);
  assert.equal(new Set(names).size, names.length);
});

// --- The labelling that makes the panel honest -----------------------------

test("the source names a benchmark and not this tenant", () => {
  assert.match(CHRONIC_SOURCE, /benchmark/i);
});

test("the reading claims no cost and no saving", () => {
  /*
    The addressable-saving figure on the outcomes screen comes out of the cost
    model, which this panel has not been through. A rand figure in this
    sentence would borrow that model's authority for a benchmark.
  */
  assert.ok(!/R\s?\d|rand|saving|cost/i.test(chronic.reading), chronic.reading);
});

test("the reading says which cohort to reach first, because a heatmap does not", () => {
  // The darkest cell is obesity in standard ops; the actionable reading is the
  // metabolic group as a whole. If this sentence is ever reduced to naming the
  // darkest cell, the panel stops being a drill-down and becomes decoration.
  assert.match(chronic.reading, /metabolic/i);
  assert.ok(chronic.reading.length > 200, "the reading has been shortened into a caption");
});

test("the module contract still says the figures are a benchmark and not measured", async () => {
  const { default: absenceModule } = await import("./module.js");
  const rails = absenceModule.guardrails.join(" ");
  assert.match(rails, /benchmark/i);
  assert.match(rails, /never a screening result|not a screening result/i);
  // The two controls that are easy to quietly drop when somebody refactors
  // the panel: the lens lock, and dropping rather than greying.
  assert.match(rails, /operational load and is not re-cut/i);
  assert.match(rails, /dropped from the chronic panel rather than greyed/i);
});

test("no condition is recorded against a protected dimension", () => {
  /*
    Operational load is the only cut this benchmark is published against. Age
    in particular is a protected attribute in this module, reported at a raised
    minimum and never available for targeting, so a chronic prevalence cut by
    age band would be the single worst version of this panel.
  */
  const protectedKeys = (portfolio.cohort_dimensions || [])
    .filter((d) => d.protected)
    .map((d) => d.key);
  for (const row of chronic.rows) {
    for (const key of Object.keys(row.byCohort)) {
      assert.ok(!protectedKeys.includes(key), `${row.condition} is cut by protected ${key}`);
    }
  }
  assert.ok(protectedKeys.includes("cohort_age"), "age stopped being protected, re-check this panel");
});

// --- The control: a suppressed cohort gets no column -----------------------

const feed = (over = {}) =>
  CHRONIC_COHORT_KEYS.map((key) => ({ key, label: key, count: 1000, ...(over[key] || {}) }));

test("with a full feed, every benchmark column is shown", () => {
  const { shown, withheld, missing } = chronicColumns(feed());
  assert.equal(shown.length, CHRONIC_COHORT_KEYS.length);
  assert.equal(withheld.length, 0);
  assert.equal(missing.length, 0);
});

test("a suppressed cohort is dropped from the grid, not greyed inside it", () => {
  /*
    The point of the panel's suppression. The value in a chronic cell is a
    benchmark and leaks nothing on its own. The column heading does: a named
    group too small to report on, with a health prevalence beside it, both
    contradicts every other screen and asserts that this employer holds health
    data about that group.
  */
  const { shown, withheld } = chronicColumns(feed({ "Light duty": { suppressed: true, count: 3 } }));
  assert.deepEqual(shown.map((c) => c.key), ["High-intensity ops", "Standard ops"]);
  assert.deepEqual(withheld.map((c) => c.key), ["Light duty"]);
  // And it is reported, rather than the grid quietly having one column fewer
  // here than on the screen above it.
  assert.equal(withheld[0].label, "Light duty");
});

test("complementary suppression is honoured the same as a small cohort", () => {
  // A cohort withheld only so another cannot be recovered by subtraction is
  // still withheld. The panel does not get to second-guess why.
  const { shown } = chronicColumns(feed({ "Standard ops": { suppressed: true, complementary: true } }));
  assert.ok(!shown.some((c) => c.key === "Standard ops"));
});

test("every cohort suppressed leaves nothing to show, and that is a state the screen has", () => {
  const all = Object.fromEntries(CHRONIC_COHORT_KEYS.map((k) => [k, { suppressed: true }]));
  const { shown, withheld } = chronicColumns(feed(all));
  assert.equal(shown.length, 0);
  assert.equal(withheld.length, 3);
});

test("a renamed cohort is reported missing rather than shifting the grid", () => {
  const renamed = feed().filter((c) => c.key !== "Standard ops");
  renamed.push({ key: "Standard operations", label: "Standard operations", count: 1000 });
  const { shown, missing } = chronicColumns(renamed);
  assert.deepEqual(missing.map((c) => c.key), ["Standard ops"]);
  // The remaining columns keep their own values: nothing slid left.
  assert.deepEqual(shown.map((c) => c.key), ["High-intensity ops", "Light duty"]);
});

test("an empty feed shows nothing rather than three unattributed columns", () => {
  const { shown, missing } = chronicColumns([]);
  assert.equal(shown.length, 0);
  assert.equal(missing.length, 3);
  assert.deepEqual(chronicColumns(undefined).shown, []);
});
