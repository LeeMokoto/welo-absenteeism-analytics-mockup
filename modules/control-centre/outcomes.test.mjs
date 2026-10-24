import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_PERIODS_PER_SIDE,
  blockers,
  canMeasure,
  comparatorsFor,
  freezeComparators,
  measureOutcome,
  seriesForChart,
  splitPeriods,
  summarise,
} from "./outcomes.js";

/*
  Written as the ways a measurement misleads, because that is the risk here. An
  outcome figure is the one number a client quotes back at you, and almost every
  way of producing it is wrong in a direction that flatters the product:
  comparators picked after the fact, a baseline that includes the intervention
  month, membership that drifts, a single period mistaken for a trend, and a
  percentage that implies a cause.
*/

// A series where winter lifts every cohort and only the targeted one gets a
// genuine improvement, which is the shape of the real demo data.
function series({ suppressTarget = false, suppressComparators = false } = {}) {
  const months = [
    "2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01",
    "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01",
  ];
  // pre mean 20, post mean 18 -> change -2
  const targetVals = [20, 20, 20, 20, 20, 16, 17, 18, 22, 20, 17, 16];
  // pre mean 12, post mean 13 -> change +1 (winter only)
  const standardVals = [12, 12, 12, 12, 12, 12, 12, 13, 15, 14, 12, 13];
  const lightVals = [8, 8, 8, 8, 8, 8, 9, 9, 10, 9, 9, 9];

  const cohort = (vals, n, suppressed) => ({
    label: "c",
    count: n,
    membership: "frozen at baseline",
    suppressed,
    periods: suppressed
      ? []
      : months.map((m, i) => ({
          period_start: m,
          data_as_of: m,
          count: n,
          absent_days_per_head_annual: vals[i],
        })),
  });

  return {
    periods: months,
    period_grain: "month",
    measure: "absent_days_per_head_annual",
    measure_source: "actual absence, not model prediction",
    membership: "frozen at the baseline period",
    suppression_threshold: 5,
    series: {
      cohort_load: {
        label: "Operational load",
        min_cohort: 5,
        cohorts: {
          "High-intensity ops": cohort(targetVals, 2030, suppressTarget),
          "Standard ops": cohort(standardVals, 3000, suppressComparators),
          "Light duty": cohort(lightVals, 700, suppressComparators),
        },
      },
    },
  };
}

const intervention = (over = {}) => ({
  id: "icv-001",
  title: "Rostering review",
  target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
  created: "2026-04-02",
  comparators: ["Standard ops", "Light duty"],
  ...over,
});

// --- The measurement itself -------------------------------------------------

test("the comparator correction changes the answer, and in this case enlarges it", () => {
  const o = measureOutcome(intervention(), series());
  assert.equal(o.targeted.baseline, 20);
  assert.equal(o.targeted.observed, 18);
  assert.equal(o.targeted.change, -2);

  // Comparators rose on winter: Standard +1, Light +1.
  assert.equal(o.comparator_change, 1);

  // So the difference is larger than the raw change, not smaller. Worth a test
  // because the assumption is always that governance shrinks the number.
  assert.equal(o.difference, -3);
  assert.ok(Math.abs(o.difference) > Math.abs(o.targeted.change));
});

test("a single month is never the measurement", () => {
  // July alone reads 22 against a baseline of 20, so a naive monthly read says
  // the intervention made things worse. The measurement averages the periods
  // either side of the boundary instead.
  const o = measureOutcome(intervention(), series());
  assert.equal(o.periods_before, 5);
  assert.equal(o.periods_after, 7);
  assert.ok(o.targeted.change < 0, "the trend is down even though one month is up");
});

test("the boundary month counts as after, not as baseline", () => {
  const months = [
    { period_start: "2026-02-01", absent_days_per_head_annual: 1 },
    { period_start: "2026-03-01", absent_days_per_head_annual: 1 },
    { period_start: "2026-04-01", absent_days_per_head_annual: 9 },
    { period_start: "2026-05-01", absent_days_per_head_annual: 9 },
  ];
  const { before, after } = splitPeriods(months, "2026-04-02");
  // A month half of which ran under the old roster is not a clean baseline
  // month, and putting it in the baseline would drag the baseline toward the
  // post period and shrink whatever is there.
  assert.deepEqual(before.map((p) => p.period_start), ["2026-02-01", "2026-03-01"]);
  assert.deepEqual(after.map((p) => p.period_start), ["2026-04-01", "2026-05-01"]);
});

// --- Comparators are frozen, and that is enforced --------------------------

test("an intervention with no frozen comparators is refused, not measured", () => {
  const i = intervention({ comparators: null });
  assert.equal(canMeasure(i, series()), false);
  assert.equal(measureOutcome(i, series()), null);
  assert.ok(
    blockers(i, series()).some((b) => b.includes("choosing them now would mean choosing them knowing the answer")),
  );
});

test("there is no fallback to a live comparator list", () => {
  // The series carries two perfectly good comparators. The record does not name
  // them, so they are not used. That refusal is the control.
  assert.deepEqual(comparatorsFor({ comparators: null }), []);
  assert.deepEqual(comparatorsFor({}), []);
  assert.deepEqual(comparatorsFor({ comparators: ["Standard ops"] }), ["Standard ops"]);
});

test("comparators are the other reportable cohorts of the same dimension", () => {
  const cohorts = {
    cohort_load: [
      { key: "High-intensity ops", count: 2030 },
      { key: "Standard ops", count: 3000 },
      { key: "Light duty", count: 700 },
      { key: "Relief pool", suppressed: true },
    ],
    cohort_fatigue: [{ key: "Critical", count: 1153 }],
  };
  const frozen = freezeComparators({ dimension: "cohort_load", cohort: "High-intensity ops" }, cohorts);

  // Not itself, not a suppressed cohort, and nothing from another dimension:
  // a cohort from another dimension overlaps the target and is partly the same
  // people, so it is not a comparison.
  assert.deepEqual(frozen, ["Standard ops", "Light duty"]);
});

test("a dimension with no other reportable cohort freezes nothing, rather than reaching further", () => {
  const cohorts = { cohort_fatigue: [{ key: "Critical", count: 1153 }] };
  assert.deepEqual(freezeComparators({ dimension: "cohort_fatigue", cohort: "Critical" }, cohorts), []);
});

// --- Not enough series -----------------------------------------------------

test("too few periods after the intervention blocks the measurement and says how few", () => {
  const i = intervention({ created: "2026-10-11" });
  const why = blockers(i, series());
  assert.ok(why.some((b) => b.includes("since the intervention")));
  assert.equal(measureOutcome(i, series()), null);
});

test("too few periods before the intervention blocks it too", () => {
  const i = intervention({ created: "2025-11-15" });
  const why = blockers(i, series());
  assert.ok(why.some((b) => b.includes("baseline")));
});

test("the minimum is two periods a side, not one", () => {
  assert.equal(MIN_PERIODS_PER_SIDE, 2);
});

// --- Suppression ------------------------------------------------------------

test("a withheld target cohort yields no outcome", () => {
  const why = blockers(intervention(), series({ suppressTarget: true }));
  assert.ok(why.some((b) => b.includes("withheld")));
  assert.equal(measureOutcome(intervention(), series({ suppressTarget: true })), null);
});

test("when every frozen comparator is withheld there is nothing to compare against", () => {
  const s = series({ suppressComparators: true });
  const why = blockers(intervention(), s);
  assert.ok(why.some((b) => b.includes("nothing to compare against")));
});

test("a partly withheld comparator set narrows the comparison and says so", () => {
  const s = series();
  s.series.cohort_load.cohorts["Light duty"].suppressed = true;
  s.series.cohort_load.cohorts["Light duty"].periods = [];

  const o = measureOutcome(intervention(), s);
  assert.ok(o, "one usable comparator is still a comparison");
  const withheld = o.comparators.filter((c) => c.withheld).map((c) => c.cohort);
  // Carried through as withheld rather than dropped, so the reader can see the
  // comparison is narrower than the one that was registered.
  assert.deepEqual(withheld, ["Light duty"]);
  assert.equal(o.comparator_change, 1);
});

// --- Two dimensions ---------------------------------------------------------

test("a two-dimension target is refused rather than measured on one of them", () => {
  const i = intervention({
    target: [
      { dimension: "cohort_load", cohort: "High-intensity ops" },
      { dimension: "cohort_tenure", cohort: "New (<2y)" },
    ],
  });
  const why = blockers(i, series());
  assert.ok(why.some((b) => b.includes("one dimension at a time")));
  assert.equal(measureOutcome(i, series()), null);
});

// --- What the interface is allowed to say -----------------------------------

test("no percentage and no single headline number is published", () => {
  const o = measureOutcome(intervention(), series());
  const said = summarise(o);

  // The refusal, asserted. A "down 12 percent" headline is the figure that gets
  // quoted back in a renewal meeting when the next quarter goes the other way.
  const everything = JSON.stringify(o) + JSON.stringify(said);
  assert.ok(!everything.includes("%"), "a percentage reached the output");
  assert.ok(!/percent/i.test(said.raw + said.context + (said.headline || "")));
  assert.equal(o.improvement_pct, undefined);
  assert.equal(o.pct_change, undefined);
  assert.equal(said.score, undefined);
});

test("nothing the interface renders claims a cause", () => {
  const said = summarise(measureOutcome(intervention(), series()));
  const rendered = [said.raw, said.context, said.headline].join(" ").toLowerCase();
  for (const word of ["caused", "because of", "thanks to", "achieved", "delivered", "proves", "resulted in"]) {
    assert.ok(!rendered.includes(word), `causal language reached the interface: ${word}`);
  }
  assert.ok(said.caveat.includes("not evidence that the intervention caused"));
  // And the caveat names the selection problem, which is the one a reader is
  // least likely to think of.
  assert.ok(said.caveat.includes("selected for being extreme"));
});

test("the summary carries its own provenance", () => {
  const said = summarise(measureOutcome(intervention(), series()));
  assert.ok(said.provenance.includes("Comparators frozen 2026-04-02"));
  assert.ok(said.provenance.includes("actual absence, not model prediction"));
  assert.ok(said.provenance.includes("frozen at the baseline period"));
});

test("a worse outcome is reported as plainly as a better one", () => {
  const s = series();
  // Flip it: the targeted cohort gets worse by more than the comparators.
  s.series.cohort_load.cohorts["High-intensity ops"].periods.forEach((p, i) => {
    p.absent_days_per_head_annual = i < 5 ? 20 : 25;
  });
  const o = measureOutcome(intervention(), s);
  assert.equal(o.targeted.change, 5);
  assert.equal(o.difference, 4);
  assert.equal(summarise(o).direction, "higher");
});

test("summarise of nothing is nothing", () => {
  assert.equal(summarise(null), null);
});

// --- The chart --------------------------------------------------------------

test("the chart carries the comparators, so the seasonal rise is visible rather than described", () => {
  const chart = seriesForChart(intervention(), series());
  assert.equal(chart.boundary, "2026-04");
  assert.equal(chart.targeted.cohort, "High-intensity ops");
  assert.equal(chart.targeted.points.length, 12);
  assert.deepEqual(chart.comparators.map((c) => c.cohort), ["Standard ops", "Light duty"]);
  // July is the month that reads worse for everyone.
  const july = (c) => c.points.find((p) => p.period === "2026-07-01").value;
  assert.ok(july(chart.targeted) > chart.targeted.points[0].value);
  assert.ok(july(chart.comparators[0]) > chart.comparators[0].points[0].value);
});

test("a chart for an unmeasurable record still returns null rather than a half series", () => {
  assert.equal(seriesForChart({ target: [] }, series()), null);
  assert.equal(seriesForChart(intervention(), { series: {} }), null);
});

// --- The real shipped series -----------------------------------------------

test("the shipped series measures the seeded intervention, and the numbers are not hand written", async () => {
  const { cohortSeries } = await import("./data/series.js");
  const { seeded } = await import("./store.js");

  const records = seeded();
  const measuring = records.find((r) => r.id === "icv-001");
  assert.ok(measuring.comparators?.length, "the seeded record must carry frozen comparators");
  // The record stores no outcome: the figure is computed, so it cannot be a
  // number somebody typed into the seed data.
  assert.equal(measuring.outcome, undefined);

  const o = measureOutcome(measuring, cohortSeries);
  assert.ok(o, "the shipped series should be able to measure the seeded intervention");
  assert.ok(o.targeted.change < 0, "the simulated roster change should read as lower absence");
  assert.ok(o.comparator_change > 0, "winter should lift the comparators over the same months");
  // The correction enlarges the estimate here, which is the case the demo is
  // built to show.
  assert.ok(
    Math.abs(o.difference) > Math.abs(o.targeted.change),
    `expected the comparator correction to enlarge the estimate, got raw ${o.targeted.change} and difference ${o.difference}`,
  );
});

test("the other seeded records are refused for their own stated reasons", async () => {
  const { cohortSeries } = await import("./data/series.js");
  const { seeded } = await import("./store.js");
  const records = seeded();

  const noComparators = records.find((r) => r.id === "icv-002");
  assert.ok(
    blockers(noComparators, cohortSeries).some((b) => b.includes("knowing the answer")),
    "a record with no frozen comparators must be refused for that reason",
  );

  const tooEarly = records.find((r) => r.id === "icv-003");
  assert.ok(
    blockers(tooEarly, cohortSeries).some((b) => b.includes("since the intervention")),
    "a record with one month of series must be refused for that reason",
  );
});

test("the shipped series is dated, monthly, and says what it measures", async () => {
  const { cohortSeries } = await import("./data/series.js");
  assert.equal(cohortSeries.period_grain, "month");
  assert.equal(cohortSeries.periods.length, 12);
  assert.ok(cohortSeries.measure_source.includes("not model prediction"));
  assert.ok(cohortSeries.membership.includes("frozen"));
  // Every period is the first of a month, which is what period_start means.
  for (const p of cohortSeries.periods) assert.match(p, /^\d{4}-\d{2}-01$/);
  // And the simulation declares itself rather than passing as observation.
  assert.equal(cohortSeries.synthetic, true);
  assert.ok(cohortSeries.simulation.mechanism.includes("No outcome is written in by hand"));
});
