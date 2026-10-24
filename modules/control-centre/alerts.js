/*
  Alert rules.

  A threshold on a cohort measure, so a change is noticed before somebody
  thinks to look. Two rules from the solution design's check-point table, and
  they are the whole reason this file is not twenty lines:

    Alert rule saved  -> the rule's cohort meets the targeting rules
    Alert evaluated   -> only cohorts at or above the threshold are evaluated;
                         smaller cohorts count within their parent, and no
                         alert names a cohort under the threshold

  The first is why saving reuses the targeting validation rather than its own:
  an alert that fires on an age band is a recurring, routed statement that an
  age group is a problem, which is worse than a one-off report, not better.

  The second is the part that is easy to get wrong. A rule written across a
  whole dimension will meet suppressed cohorts when it runs. Evaluating them
  would put a sub-threshold cohort's name in an email, which is the small-cell
  problem with a delivery mechanism attached. They are skipped, counted, and
  reported as skipped, so nobody mistakes silence for safety.
*/

// Explicit extension: this module is in the Node test runner's import graph,
// and Node's ESM loader does not guess one the way the bundler does.
import { validateTarget } from "./targeting.js";

/*
  What a rule may watch. Rates and averages only.

  Counts are deliberately absent. A rule on "high or critical count above 400"
  fires because a cohort is large, not because it is unwell, and the action it
  prompts is aimed at the wrong group. Shares and per-head figures compare
  cohorts of different sizes honestly, which is what an alert needs to do.
*/
export const MEASURES = [
  {
    key: "high_or_critical_share",
    label: "Share at high or critical risk",
    unit: "share",
    hint: "Proportion of the cohort the model places in the top two bands.",
  },
  {
    key: "absent_days_per_head_annual",
    label: "Absent days per head, annual",
    unit: "days",
    hint: "Absence load carried by the average person in the cohort.",
  },
  {
    key: "mean_fatigue",
    label: "Mean fatigue score",
    unit: "score",
    hint: "The strongest single driver in the model.",
  },
];

export const COMPARISONS = [
  { key: "above", label: "rises above", test: (v, t) => v > t },
  { key: "below", label: "falls below", test: (v, t) => v < t },
];

export function measure(key) {
  return MEASURES.find((m) => m.key === key) || null;
}

export function comparison(key) {
  return COMPARISONS.find((c) => c.key === key) || null;
}

/*
  Validate a rule before it is saved.

  `scope` is either { dimension } for every cohort in a dimension, or
  { dimension, cohort } for one. Both go through the targeting rules: a
  dimension nobody may target is a dimension nobody may route alerts about.
*/
export function validateRule(rule, context) {
  const errors = [];
  const r = rule || {};

  if (!r.name || !String(r.name).trim()) {
    errors.push("A rule needs a name, because it appears in the alert it sends.");
  }

  if (!measure(r.measure)) {
    errors.push("A rule needs a measure to watch.");
  }

  if (!comparison(r.comparison)) {
    errors.push("A rule needs a comparison.");
  }

  // Number("") is 0, not NaN, so an empty threshold would otherwise validate
  // as zero and the rule would fire on every cohort it met. Blank is missing,
  // not zero.
  const raw = r.threshold;
  const blank = raw === "" || raw === null || raw === undefined;
  const threshold = Number(raw);
  if (blank || !Number.isFinite(threshold)) {
    errors.push("A rule needs a numeric threshold.");
  }

  if (!r.scope?.dimension) {
    errors.push("A rule needs a dimension to watch.");
  } else {
    // A whole-dimension rule is validated against any one of its reportable
    // cohorts: what is being checked is the dimension's eligibility, and the
    // cohort-level checks run again at evaluation for every cohort it meets.
    const cohorts = (context?.cohorts || {})[r.scope.dimension] || [];
    const probe =
      r.scope.cohort ?? cohorts.find((c) => !c.suppressed)?.key ?? null;

    if (probe === null) {
      errors.push("Every cohort in that dimension is suppressed, so a rule on it could never fire.");
    } else {
      const check = validateTarget(
        [{ dimension: r.scope.dimension, cohort: probe }],
        context
      );
      errors.push(...check.errors);
    }
  }

  return { ok: errors.length === 0, errors };
}

/*
  Run a rule over the current feed.

  Returns what fired, what did not, and what could not be evaluated. The third
  is not padding: a rule that silently skips half a dimension looks identical
  to a rule that found nothing wrong, and the difference matters.
*/
export function evaluateRule(rule, { cohorts, suppressionThreshold = 5 } = {}) {
  const m = measure(rule?.measure);
  const c = comparison(rule?.comparison);
  const rows = (cohorts || {})[rule?.scope?.dimension] || [];
  const scoped = rule?.scope?.cohort
    ? rows.filter((row) => row.key === rule.scope.cohort)
    : rows;

  const firing = [];
  const quiet = [];
  const skipped = [];

  if (!m || !c) return { firing, quiet, skipped, invalid: true };

  for (const row of scoped) {
    // Suppressed either way: too small to report is too small to name in an
    // alert. Counted so the rule can say how much of the dimension it could
    // not see.
    if (row.suppressed) {
      skipped.push({
        cohort: row.label,
        reason:
          row.suppression === "complementary"
            ? "withheld to protect another cohort's suppression"
            : `under the reporting minimum of ${row.suppressed_below ?? suppressionThreshold}`,
      });
      continue;
    }

    if ((row.count ?? 0) < suppressionThreshold) {
      skipped.push({ cohort: row.label, reason: `under the threshold of ${suppressionThreshold}` });
      continue;
    }

    const value = row[m.key];
    if (value == null) {
      skipped.push({ cohort: row.label, reason: `no ${m.label.toLowerCase()} reported` });
      continue;
    }

    const hit = c.test(Number(value), Number(rule.threshold));
    (hit ? firing : quiet).push({ cohort: row.label, value: Number(value), count: row.count });
  }

  return { firing, quiet, skipped, invalid: false };
}

export function evaluateAll(rules, context) {
  return (rules || [])
    .filter((r) => r.enabled !== false)
    .map((rule) => ({ rule, result: evaluateRule(rule, context) }));
}

/*
  How a rule reads in a sentence, for the rule list and the alert itself. A
  rule nobody can read is a rule nobody audits.
*/
export function describeRule(rule, dimensions) {
  const m = measure(rule?.measure);
  const c = comparison(rule?.comparison);
  const dim = (dimensions || []).find((d) => d.key === rule?.scope?.dimension);
  const where = rule?.scope?.cohort
    ? `${dim?.label || rule?.scope?.dimension}: ${rule.scope.cohort}`
    : `any cohort of ${dim?.label || rule?.scope?.dimension}`;
  if (!m || !c) return "Incomplete rule.";
  return `Alert when ${m.label.toLowerCase()} ${c.label} ${formatThreshold(rule.threshold, m)} for ${where}.`;
}

export function formatThreshold(value, m) {
  if (value == null) return "n/a";
  if (m?.unit === "share") return `${(Number(value) * 100).toFixed(1)}%`;
  return String(value);
}

export function formatValue(value, m) {
  return formatThreshold(value, m);
}
