/*
  How a suppressed cohort renders.

  One definition, because the wording is a disclosure control rather than
  copy. There are two reasons a cohort carries no figures and they are not
  interchangeable:

  - Primary. The cohort is under the tenant threshold. "n<5" is accurate.
  - Complementary. The cohort is large enough to report and is withheld anyway,
    so that a primary suppression elsewhere in the same table cannot be
    recovered by subtracting the visible rows from a published total.

  Labelling a complementary suppression as "fewer than 5 covered lives" would
  be a false statement about a cohort that may hold hundreds of people, shown
  to a client. The feed marks which is which; these read that mark.
*/

export function isComplementary(cohort) {
  return cohort?.suppression === "complementary";
}

// The short label in the cell where a figure would be.
export function suppressionLabel(cohort) {
  return isComplementary(cohort) ? "withheld" : "n<5";
}

// The sentence that explains the empty row.
export function suppressionReason(cohort, threshold) {
  return isComplementary(cohort)
    ? "Withheld so that a suppressed cohort in this table cannot be recovered by subtraction"
    : `Suppressed, fewer than ${cohort?.suppressed_below ?? threshold} covered lives`;
}

// Longer form, for the card layout on the cohorts screen.
export function suppressionNote(cohort, threshold) {
  return isComplementary(cohort)
    ? "Withheld. This cohort is large enough to report, but another cohort in this view is suppressed, and publishing this one beside the total would give the suppressed figure away by subtraction."
    : `Suppressed: fewer than ${cohort?.suppressed_below ?? threshold} covered lives, so no figures are reported.`;
}

// Totals and shares are over the cohorts actually shown. Saying so matters
// once any row is withheld, because a reader otherwise reads the total as the
// whole population and the difference is the thing suppression is hiding.
export function visibleTotals(cohorts, measure) {
  const visible = (cohorts || []).filter((c) => !c.suppressed);
  return {
    visible,
    withheld: (cohorts || []).length - visible.length,
    count: visible.reduce((a, c) => a + (c.count || 0), 0),
    measure: visible.reduce((a, c) => a + (c[measure] || 0), 0),
  };
}
