/*
  Targeting rules.

  The control centre is the first place the platform writes something down
  about a group of people and keeps it. A dashboard view is transient; an
  intervention record is a durable statement that this cohort was singled out,
  stored under the tenant and read later by people who were not in the room.
  So targeting is held to stricter rules than reporting, and this file is where
  they live.

  Four rules, each from the solution design document:

  1. Targeting is a subset of reporting. A dimension nobody may report on is
     not a dimension anyone may target.
  2. Protected attributes are never targetable. Age is a reporting dimension by
     decision, with a raised minimum cohort size; that decision does not make it
     a targeting dimension. The Employment Equity Act prohibits unfair
     discrimination on grounds including age, and an intervention record naming
     an age band is exactly the artefact that reads as discrimination later.
  3. At most two dimensions in a target. Each dimension added narrows the group
     toward individuals, which is the thing the cohort-only design exists to
     prevent.
  4. Condition data is never targetable. It is special personal information
     under POPIA and targeting on it is what turns a health platform into a
     surveillance one.

  Everything here is pure and synchronous so it can run at the point of save,
  in the API, and in a test, with the same answer in all three.
*/

// Dimensions a target may never use, whatever the manifest says. The manifest
// narrows this list; it cannot widen it.
export const NEVER_TARGETABLE = {
  // Protected under the Employment Equity Act.
  cohort_age: "age is a protected attribute",
  // Health information under POPIA sections 26 and 32.
  cohort_condition: "condition data is special personal information",
  cohort_gender: "gender is a protected attribute",
  cohort_race: "race is a protected attribute",
  cohort_disability: "disability is a protected attribute",
};

// Lifestyle risk is smoking and drinking. It is neither a protected attribute
// nor a condition chapter, so the rules above do not exclude it, and it is
// still not a default targeting dimension: an intervention record saying a
// cohort was selected for being drinkers is a durable statement about people's
// private conduct. A tenant that wants it has to say so.
export const TARGETABLE_BY_DEFAULT = ["cohort_load", "cohort_fatigue", "cohort_tenure"];

export const MAX_TARGET_DIMENSIONS = 2;

/*
  The dimensions this tenant may target, given what the feed reports and what
  the manifest allows. Returns the dimension objects, not just keys, so a
  caller can show labels without a second lookup.
*/
export function targetableDimensions(dimensions, allowed = TARGETABLE_BY_DEFAULT) {
  return (dimensions || []).filter(
    (d) => !NEVER_TARGETABLE[d.key] && !d.protected && allowed.includes(d.key)
  );
}

/*
  Why a dimension cannot be targeted, or null if it can. Separate from the
  filter above because the interface should say why a dimension is missing
  rather than silently omit it: a user who cannot find age will otherwise
  assume a bug and ask for it to be added.
*/
export function untargetableReason(dimension, allowed = TARGETABLE_BY_DEFAULT) {
  if (!dimension) return "unknown dimension";
  if (NEVER_TARGETABLE[dimension.key]) return NEVER_TARGETABLE[dimension.key];
  if (dimension.protected) return "protected attribute";
  if (!allowed.includes(dimension.key)) return "not in this tenant's targeting list";
  return null;
}

/*
  Validate a proposed target. Returns { ok, errors }, with every failure
  reported rather than the first, so a user fixes one form rather than three.

  `selections` is [{ dimension, cohort }]. `cohorts` is the feed's cohorts map,
  used to check the targeted group is actually reportable: a target whose
  cohort is suppressed would be an intervention aimed at a group too small to
  report on, which is the small-cell problem with a record attached.
*/
export function validateTarget(selections, { dimensions, cohorts, allowed = TARGETABLE_BY_DEFAULT } = {}) {
  const errors = [];
  const picks = selections || [];

  if (picks.length === 0) {
    errors.push("A target needs at least one cohort.");
  }

  if (picks.length > MAX_TARGET_DIMENSIONS) {
    errors.push(
      `A target may combine at most ${MAX_TARGET_DIMENSIONS} dimensions. Each one added narrows the group toward individuals.`
    );
  }

  const seen = new Set();
  for (const pick of picks) {
    if (seen.has(pick.dimension)) {
      errors.push(`${pick.dimension} is selected twice.`);
    }
    seen.add(pick.dimension);

    const dim = (dimensions || []).find((d) => d.key === pick.dimension);
    const reason = untargetableReason(dim, allowed);
    if (reason) {
      errors.push(`${dim?.label || pick.dimension} cannot be targeted: ${reason}.`);
      continue;
    }

    const row = ((cohorts || {})[pick.dimension] || []).find((c) => c.key === pick.cohort);
    if (!row) {
      errors.push(`${pick.cohort} is not a cohort of ${dim.label}.`);
    } else if (row.suppressed) {
      errors.push(
        `${dim.label}: ${pick.cohort} is suppressed, so it is too small to target.`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/*
  Headcount of a target, or null when it cannot be established.

  A single dimension reads straight off the cohort row. Two dimensions
  intersect, and the feed carries no cross-tabulation, so the honest answer is
  that we do not know it yet rather than a number inferred from the marginals.
  Returning null makes the caller handle it; returning a guess would put an
  invented headcount on a durable record.
*/
export function targetHeadcount(selections, cohorts) {
  const picks = selections || [];
  if (picks.length !== 1) return null;
  const row = ((cohorts || {})[picks[0].dimension] || []).find((c) => c.key === picks[0].cohort);
  return row && !row.suppressed ? row.count ?? null : null;
}

/*
  The check your solution design names "Intervention saved": targeting rules,
  plus a targeted headcount at or above the threshold.
*/
export function canSaveIntervention(selections, context) {
  const base = validateTarget(selections, context);
  const errors = [...base.errors];

  const n = targetHeadcount(selections, context?.cohorts);
  const threshold = context?.suppressionThreshold ?? 5;

  if (base.ok && n !== null && n < threshold) {
    errors.push(
      `The target holds ${n} people, under the threshold of ${threshold}. An intervention cannot name a group this small.`
    );
  }

  // Two dimensions intersect to an unknown headcount. The rules above still
  // apply to each dimension, and the intersection is necessarily no larger
  // than the smaller marginal, so it can be at or below the threshold without
  // anything here knowing. Flagged rather than blocked, and the record carries
  // the flag.
  const needsConfirmation = base.ok && n === null && (selections || []).length > 1;

  return { ok: errors.length === 0, errors, headcount: n, needsConfirmation };
}
