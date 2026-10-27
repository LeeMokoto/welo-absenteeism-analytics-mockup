/*
  Chronic disease screening prevalence, by operational-load cohort.

  READ THIS BEFORE SHOWING THESE NUMBERS TO ANYONE.

  These are benchmark figures. They are not this tenant's data, they are not
  model output, and nobody in this workforce has been screened. Every other
  figure in modules/absence/data/portfolio.js comes out of the pipeline; these
  do not, which is why they live in their own file instead of being folded into
  that one. A generated file and a hand-written benchmark in the same object is
  how a benchmark ends up quoted as a finding.

  What they are: published prevalence for a South African frontline industrial
  workforce, shaped across the three operational-load cohorts so the pattern a
  screening programme would expect to find is visible before one has run. The
  shape is the point, not the digits. "Light duty carries the respiratory
  burden, high-intensity ops carries the cardiovascular one" is the claim worth
  making, and it is the claim a reader should take away.

  Why they are here at all: the standalone dashboard has carried this panel
  since the first build, and the platform shell was ported without it. A
  prospect comparing the two finds the platform thinner than the dashboard it
  replaces. The honest fix is to port the panel with its labelling intact, not
  to quietly drop a view the product is expected to have.

  What replaces them: pilot screening results, per tenant, at cohort level and
  under the same suppression as everything else. When that lands this file is
  deleted rather than edited, because the moment a tenant has its own screening
  data, a benchmark sitting beside it under the same heading is worse than no
  benchmark at all.

  The values are the dashboard's shipped default profile, kept byte-identical
  so the two surfaces cannot drift into quoting different numbers at the same
  prospect.
*/

export const CHRONIC_SOURCE =
  "Published South African frontline workforce prevalence benchmarks, applied to this tenant's cohort structure.";

// The column order is the operational-load cohort order. These keys must match
// the cohort keys in portfolio.js: the screen looks each one up rather than
// trusting the order, so a renamed cohort shows as missing instead of silently
// shifting a row's values one column to the left.
export const CHRONIC_COHORT_KEYS = ["High-intensity ops", "Standard ops", "Light duty"];

export const chronic = {
  // Prevalence as a percentage of the cohort that would screen positive.
  // `workforce` is the all-cohort figure, carried from the benchmark rather
  // than averaged from the three: a weighted mean of three benchmark columns
  // would imply the columns are a sample of this workforce, and they are not.
  rows: [
    { condition: "Obesity, waist-to-height over 0.6", group: "Metabolic", byCohort: { "High-intensity ops": 31, "Standard ops": 34, "Light duty": 28 }, workforce: 31 },
    { condition: "Hypertension", group: "Cardiovascular", byCohort: { "High-intensity ops": 28, "Standard ops": 24, "Light duty": 26 }, workforce: 26 },
    { condition: "Pre-diabetes", group: "Metabolic", byCohort: { "High-intensity ops": 19, "Standard ops": 22, "Light duty": 17 }, workforce: 19 },
    { condition: "Depression or anxiety, screen positive", group: "Mental health", byCohort: { "High-intensity ops": 17, "Standard ops": 15, "Light duty": 16 }, workforce: 16 },
    { condition: "Type 2 diabetes", group: "Metabolic", byCohort: { "High-intensity ops": 12, "Standard ops": 16, "Light duty": 10 }, workforce: 13 },
    { condition: "Asthma or COPD", group: "Respiratory", byCohort: { "High-intensity ops": 8, "Standard ops": 9, "Light duty": 14 }, workforce: 10 },
  ],

  /*
    The reading, written out rather than left for the viewer to infer, because
    a heatmap invites the eye to the darkest cell and the darkest cell here is
    not the most actionable one.

    Deliberately not a cost or a saving. The addressable-saving figure on the
    outcomes screen is derived from predicted absence; attaching it to a
    screening benchmark would imply this panel had been through the cost model,
    and it has not.
  */
  reading:
    "The metabolic stack, obesity and pre-diabetes and type 2 diabetes, is the largest modifiable group in every cohort. Standard ops carries the most of it, which is the cohort a screening programme would reach first. The respiratory concentration in light duty is the one pattern that inverts: it is the cohort with the least absence and the most airway disease, consistent with people already moved onto lighter work.",
};

/*
  Which columns the panel shows, and why each one is absent.

  A plain function rather than logic inside the component, because this is the
  control that keeps a suppressed cohort from appearing under a health
  prevalence, and a control that can only be exercised by rendering a page is a
  control nobody exercises. The component renders what this returns.

  Lookup is by key, never by position. A cohort renamed upstream drops its
  column and is reported as missing; the alternative is every row's values
  shifting one place and the grid staying confidently wrong.
*/
export function chronicColumns(cohorts = []) {
  const columns = CHRONIC_COHORT_KEYS.map((key) => {
    const row = (cohorts || []).find((c) => c.key === key);
    return {
      key,
      row: row || null,
      label: row?.label || key,
      present: Boolean(row),
      // A cohort the feed withheld for any reason, including complementary
      // suppression, is withheld here too. The value in this panel is a
      // benchmark and leaks nothing by itself; the column heading beside it
      // still says this employer holds health data on a group too small to
      // report on.
      suppressed: Boolean(row?.suppressed),
    };
  });

  return {
    all: columns,
    shown: columns.filter((c) => c.present && !c.suppressed),
    withheld: columns.filter((c) => c.present && c.suppressed),
    missing: columns.filter((c) => !c.present),
  };
}
