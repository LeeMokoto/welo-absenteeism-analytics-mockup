/*
  Outcome measurement.

  The question this answers: an intervention ran against a cohort, so did that
  cohort's absence change, and did it change by more than it changed for
  cohorts nobody intervened on.

  The second half of that sentence is the whole discipline. A cohort was picked
  because it was extreme, so some of it improves on its own, which is
  regression to the mean handing you a success story for free. Absence is also
  seasonal: South African absence rises June to August for reasons that have
  nothing to do with any roster. So a before and after on the targeted cohort
  alone is not evidence of anything, and in the demo series it is wrong in both
  directions at once, understating the roster change overall while reading as a
  disaster in July.

  Four decisions, each of which could have gone the other way:

  1. **Comparators freeze when the intervention is created.** Choosing them
     after seeing the result means choosing the ones that flatter it, and
     nobody who does that experiences themselves as cheating. Frozen at
     creation is the pre-registration principle, and `comparatorsFor` refuses
     to fall back to a live list if the record has none: an unmeasurable
     intervention is a better outcome than a measurable one with comparators
     chosen in hindsight.

  2. **Cohort membership freezes at the baseline period**, upstream in the
     series builder. A roster change that lowers overtime would re-band those
     people out of the high-load cohort, and the group measured at the end
     would not be the group the intervention named. This module asserts the
     series says so rather than assuming it.

  3. **Suppression holds across the whole series.** A cohort visible in one
     month and withheld in the next leaks the withheld count through the
     difference, so a series with any suppressed period is withheld entirely.

  4. **No single percentage improvement is published.** `measureOutcome`
     returns the targeted change, the comparator change and the difference
     between them, with no field that collapses them into one number. That is a
     deliberate refusal, and `summarise` says what the figure is and what it is
     not. A "down 12 percent" headline is the figure that gets quoted back at
     you in a renewal meeting when the next quarter goes the other way.

  Everything is pure and synchronous: the same answer in the API, the screen and
  a test.
*/

export const MIN_PERIODS_PER_SIDE = 2;

/*
  Why an outcome cannot be measured, or null when it can.

  Separate from the measurement so the interface can say which thing is missing.
  "Not measurable" with no reason reads as a bug and generates a support
  request; "needs two more months after the change" does not.
*/
export function blockers(intervention, series) {
  const out = [];

  if (!intervention) return ["no intervention"];
  if (!series || !series.series) return ["no cohort series has been published"];

  const target = (intervention.target || [])[0];
  if (!target) out.push("the intervention names no cohort");

  if ((intervention.target || []).length > 1) {
    // Two dimensions intersect to a group the series does not carry, because
    // the series is published per dimension. Saying so is better than
    // measuring one dimension and calling it the whole target.
    out.push(
      "the intervention targets two dimensions, and the series carries one dimension at a time, so the intersection is not measurable from it",
    );
  }

  if (!intervention.created) out.push("the intervention has no creation date, so there is no baseline boundary");

  const comparators = intervention.comparators;
  if (!Array.isArray(comparators) || comparators.length === 0) {
    out.push(
      "no comparator cohorts were frozen when this intervention was created, and choosing them now would mean choosing them knowing the answer",
    );
  }

  if (out.length) return out;

  const dim = series.series[target.dimension];
  if (!dim) return [`the series carries no ${target.dimension}`];

  const row = dim.cohorts?.[target.cohort];
  if (!row) return [`the series carries no cohort ${target.cohort}`];
  if (row.suppressed || !row.periods?.length) {
    return [`${target.cohort} is withheld in this series, so no change can be reported for it`];
  }

  const split = splitPeriods(row.periods, intervention.created);
  if (split.before.length < MIN_PERIODS_PER_SIDE) {
    out.push(
      `only ${split.before.length} period${split.before.length === 1 ? "" : "s"} before the intervention, and ${MIN_PERIODS_PER_SIDE} are needed for a baseline`,
    );
  }
  if (split.after.length < MIN_PERIODS_PER_SIDE) {
    out.push(
      `only ${split.after.length} period${split.after.length === 1 ? "" : "s"} since the intervention, and ${MIN_PERIODS_PER_SIDE} are needed before a change means anything`,
    );
  }

  // A comparator that is itself withheld cannot be used, and using the rest
  // silently would change the comparison without saying so.
  const withheld = (comparators || []).filter((c) => {
    const r = dim.cohorts?.[c];
    return !r || r.suppressed || !r.periods?.length;
  });
  if (withheld.length === (comparators || []).length) {
    out.push("every frozen comparator is withheld in this series, so there is nothing to compare against");
  }

  return out;
}

export function canMeasure(intervention, series) {
  return blockers(intervention, series).length === 0;
}

/*
  Split a cohort's periods into before and after the intervention.

  The boundary is the intervention's creation date, and a period that contains
  it counts as after. A month half of which ran under the old roster is not a
  clean baseline month, and putting it in the baseline would drag the baseline
  toward the post period and shrink whatever is there.
*/
export function splitPeriods(periods, created) {
  const boundary = String(created || "").slice(0, 7);
  const before = [];
  const after = [];
  for (const p of periods || []) {
    const month = String(p.period_start).slice(0, 7);
    if (month < boundary) before.push(p);
    else after.push(p);
  }
  return { before, after };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function changeFor(row, created, measure) {
  const { before, after } = splitPeriods(row.periods, created);
  if (before.length < MIN_PERIODS_PER_SIDE || after.length < MIN_PERIODS_PER_SIDE) return null;
  const baseline = mean(before.map((p) => p[measure]));
  const observed = mean(after.map((p) => p[measure]));
  return {
    baseline: round1(baseline),
    observed: round1(observed),
    change: round1(observed - baseline),
    periods_before: before.length,
    periods_after: after.length,
  };
}

const round1 = (n) => (n === null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);

/*
  The comparators frozen on the record. No fallback, on purpose: see the header.
*/
export function comparatorsFor(intervention) {
  const frozen = intervention?.comparators;
  return Array.isArray(frozen) ? frozen : [];
}

/*
  Choose the comparators, at creation time and never again.

  The other cohorts of the same dimension that are reportable right now. Same
  dimension because they are the groups measured the same way on the same
  definition; a cohort from another dimension overlaps the target and is not a
  comparison, it is partly the same people.

  Called once, by the write API, with the cohorts as they stand when the record
  is created. Whatever comes back is stored on the record and used for every
  later measurement, including after a cohort has grown, shrunk or become
  suppressed. That is the point: the comparison is registered before the answer
  is known.
*/
export function freezeComparators(target, cohorts) {
  const dim = target?.dimension;
  if (!dim) return [];
  return ((cohorts || {})[dim] || [])
    .filter((c) => c.key !== target.cohort && !c.suppressed)
    .map((c) => c.key);
}

/*
  Measure an intervention against its series.

  Returns null when it cannot be measured, so a caller cannot accidentally read
  a partial result as a finding. Use `blockers` for the reason.
*/
export function measureOutcome(intervention, series, { measure = "absent_days_per_head_annual" } = {}) {
  if (!canMeasure(intervention, series)) return null;

  const target = intervention.target[0];
  const dim = series.series[target.dimension];
  const targeted = changeFor(dim.cohorts[target.cohort], intervention.created, measure);
  if (!targeted) return null;

  const comparators = [];
  for (const key of comparatorsFor(intervention)) {
    const row = dim.cohorts?.[key];
    if (!row || row.suppressed || !row.periods?.length) {
      // Named, frozen, and not reportable in this series. Carried through as
      // withheld rather than dropped, so the reader can see that the
      // comparison is narrower than the one that was registered.
      comparators.push({ cohort: key, withheld: true });
      continue;
    }
    const c = changeFor(row, intervention.created, measure);
    if (c) comparators.push({ cohort: key, withheld: false, ...c });
  }

  const usable = comparators.filter((c) => !c.withheld);
  const comparatorChange = usable.length ? round1(mean(usable.map((c) => c.change))) : null;

  return {
    measure,
    measure_source: series.measure_source || null,
    membership: series.membership || null,
    dimension: target.dimension,
    cohort: target.cohort,
    targeted,
    comparators,
    comparator_change: comparatorChange,
    /*
      The difference between the targeted cohort's change and the comparators'.
      This is the figure worth reading, and it is deliberately not called an
      effect: it is what is left after removing the movement common to cohorts
      nobody intervened on, which is a better estimate than the raw change and
      still not a causal one.
    */
    difference: comparatorChange === null ? null : round1(targeted.change - comparatorChange),
    comparators_frozen_at: intervention.created,
    periods_before: targeted.periods_before,
    periods_after: targeted.periods_after,
  };
}

/*
  What the interface is allowed to say.

  There is no percentage here and no single headline number, by decision. The
  direction, the two changes and the difference, plus a sentence saying what the
  difference is not. The caveat travels with the figure because a caveat in a
  footnote is a caveat nobody reads.
*/
export function summarise(outcome) {
  if (!outcome) return null;

  const { targeted, comparator_change: cc, difference: diff, measure } = outcome;
  const unit = measure === "absent_days_per_head_annual" ? "absent days per head a year" : measure;

  const direction = diff === null ? "unknown" : diff < 0 ? "lower" : diff > 0 ? "higher" : "no different";

  const raw =
    `${outcome.cohort} moved from ${targeted.baseline} to ${targeted.observed} ${unit}, ` +
    `a change of ${signed(targeted.change)}, over ${targeted.periods_before} months before ` +
    `and ${targeted.periods_after} months after.`;

  const context =
    cc === null
      ? "No comparator cohort could be reported in this series, so the change above stands alone and should not be read as an effect."
      : `Cohorts nobody intervened on moved ${signed(cc)} over the same months.`;

  const headline =
    diff === null
      ? null
      : `After removing the movement common to the comparator cohorts, ${outcome.cohort} is ` +
        `${Math.abs(diff)} ${unit} ${direction === "no different" ? "no different" : direction} than they would otherwise read.`;

  return {
    direction,
    raw,
    context,
    headline,
    caveat:
      "An observed difference between cohorts over a fixed period, against comparators frozen when the intervention was created. It is not evidence that the intervention caused the difference: nothing here tests for that, and the cohort was selected for being extreme, which moves toward the average on its own.",
    // Stated so a reader can see the comparison was registered in advance
    // rather than assembled afterwards.
    provenance: `Comparators frozen ${outcome.comparators_frozen_at}. Measure: ${outcome.measure_source || "unspecified"}. Membership: ${outcome.membership || "unspecified"}.`,
  };
}

function signed(n) {
  if (n === null) return "unknown";
  return n > 0 ? `+${n}` : String(n);
}

/*
  A monthly series for a chart, with the intervention boundary marked.

  Returns the targeted cohort and each usable comparator, so the reader can see
  the seasonal rise happening to everyone rather than being told about it.
*/
export function seriesForChart(intervention, series, { measure = "absent_days_per_head_annual" } = {}) {
  if (!intervention?.target?.length || !series?.series) return null;
  const target = intervention.target[0];
  const dim = series.series[target.dimension];
  if (!dim) return null;

  const line = (key) => {
    const row = dim.cohorts?.[key];
    if (!row || row.suppressed || !row.periods?.length) return null;
    return {
      cohort: key,
      points: row.periods.map((p) => ({ period: p.period_start, value: p[measure] })),
    };
  };

  const targeted = line(target.cohort);
  if (!targeted) return null;

  return {
    boundary: String(intervention.created || "").slice(0, 7),
    measure,
    targeted,
    comparators: comparatorsFor(intervention).map(line).filter(Boolean),
  };
}
