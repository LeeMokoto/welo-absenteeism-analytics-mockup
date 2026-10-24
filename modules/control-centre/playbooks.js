/*
  Playbooks: the plan attached to an intervention.

  An intervention says a cohort was singled out and why. A playbook says what
  will actually be done about it: the steps, who owns each one, over what
  horizon, and which reportable measure will be watched. An agent drafts it, a
  human decides it, and the decision is recorded separately from the drafting.

  Four controls, and each one is here because the alternative is a plausible
  accident rather than a hypothetical:

  1. A playbook has no target of its own. It inherits the intervention's, so a
     plan can never reach a wider or different group than the record it hangs
     off. Carrying a second target would mean two places to check, and the
     second one would eventually not be checked.

  2. No step names a person. The whole product is cohort level, and a plan is
     exactly where someone would write "speak to EMP-10432" because it reads as
     operational rather than analytical. Refused, not stripped: a step whose
     meaning depended on a name is not the same step with the name removed.

  3. No step is a disciplinary or attendance-management action. This is the
     care-not-discipline position, and it is the one an agent draft can drift
     into while sounding helpful: "issue a written warning after the third
     occurrence" is a sentence a language model will produce if the data looks
     like attendance data. POPIA section 71 also means a decision about a person
     cannot rest on automated processing, and a playbook step is the artefact
     that would carry one.

  4. A measure must be one the platform can actually report. A plan promising to
     track something the feed does not carry is a plan nobody can close out, and
     it is how an intervention ends up declared a success on no evidence.

  On the keyword screen in rule 3: it catches the obvious and not the clever.
  That is why a human approves every playbook and why the approver cannot be the
  drafter. The screen is a floor under human review, not a replacement for it,
  and saying so here is the honest version.

  Everything is pure and synchronous, so the same answer comes back in the API,
  in the screen and in a test.
*/

import { MEASURES } from "./alerts.js";
import { INDIVIDUAL_FIELDS } from "./store.js";

export const PLAYBOOK_STATUSES = ["Drafted", "In review", "Approved", "Rejected", "Superseded"];

// A step's horizon. Deliberately coarse: a plan at cohort level does not have a
// meaningful day-level schedule, and offering one invites a precision the data
// cannot support.
export const HORIZONS = [
  { key: "immediate", label: "Within two weeks" },
  { key: "short", label: "Within a quarter" },
  { key: "sustained", label: "Ongoing, reviewed quarterly" },
];

/*
  Who can own a step. Functions, never named people: a playbook is read later by
  people who were not in the room, and a function still means something when the
  individual has moved on.
*/
export const STEP_OWNERS = [
  "Occupational health",
  "HR business partner",
  "Operations lead",
  "Shift scheduling",
  "Wellness programme",
  "Health and safety",
];

export const MAX_STEPS = 6;

export function horizon(key) {
  return HORIZONS.find((h) => h.key === key) || null;
}

/*
  Language that makes a step a disciplinary or attendance-management action
  rather than a care one.

  Grouped so a refusal can say which line was crossed instead of just "not
  allowed", because a drafter who does not understand the refusal rewrites it
  into something that passes the screen and breaks the same rule.
*/
export const REFUSED_STEP_LANGUAGE = [
  {
    reason: "a disciplinary process",
    terms: [
      "disciplinary",
      "written warning",
      "verbal warning",
      "final warning",
      "misconduct",
      "ccma",
      "hearing",
      "sanction",
      "dismiss",
      "termination",
      "performance improvement plan",
      "capability process",
    ],
  },
  {
    reason: "treating absence as suspect rather than as a health signal",
    terms: [
      "abuse of sick leave",
      "sick leave abuse",
      "malinger",
      "genuine or not",
      "legitimacy of",
      "suspicious pattern",
      "absence pattern of",
      "unauthorised absence",
      "absenteeism offender",
      "serial absentee",
    ],
  },
  {
    reason: "surveillance of a person rather than support for a cohort",
    terms: [
      "monitor individual",
      "track individual",
      "home visit",
      "surveillance",
      "private investigator",
      "verify the certificate",
      "check up on",
    ],
  },
  {
    reason: "an employment consequence attached to a health measure",
    terms: [
      "deny leave",
      "withhold pay",
      "dock pay",
      "unpaid as a consequence",
      "forfeit",
      "bonus penalty",
      "attendance bonus",
    ],
  },
];

/*
  Patterns that mean a free-text field is carrying an individual rather than a
  cohort. The employee key format the generators use, an email, and a South
  African ID number length.
*/
const INDIVIDUAL_PATTERNS = [
  { re: /\bEMP-\d{3,}\b/i, what: "an employee key" },
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, what: "an email address" },
  { re: /\b\d{13}\b/, what: "something shaped like an identity number" },
  { re: /\bemployee\s+(?:number|id)\s*[:#]?\s*\d+/i, what: "an employee number" },
];

export function refusedLanguageIn(text) {
  const haystack = String(text || "").toLowerCase();
  const hits = [];
  for (const group of REFUSED_STEP_LANGUAGE) {
    for (const term of group.terms) {
      if (haystack.includes(term)) hits.push({ term, reason: group.reason });
    }
  }
  return hits;
}

export function individualReferenceIn(text) {
  const s = String(text || "");
  const hits = [];
  for (const { re, what } of INDIVIDUAL_PATTERNS) {
    if (re.test(s)) hits.push(what);
  }
  for (const field of INDIVIDUAL_FIELDS) {
    // A step that names the field is describing per-person data even when it
    // carries no value yet.
    //
    // Only the fields that are unambiguous as data references, though. Some
    // entries in INDIVIDUAL_FIELDS are ordinary English words, and matching
    // those refused a correctly worded step: "applied to the roster rather
    // than to individuals" names no individual, it says the opposite, and the
    // screen rejected it for the word. "Send an email to the cohort" would
    // have gone the same way. A screen that refuses the right sentence teaches
    // people to write a worse one.
    if (AMBIGUOUS_FIELD_WORDS.has(field)) continue;
    if (new RegExp(`\\b${field.replace(/_/g, "[ _]")}\\b`, "i").test(s)) {
      hits.push(`the field ${field}`);
    }
  }
  return [...new Set(hits)];
}

/*
  Fields whose names are also ordinary words, so they are not treated as data
  references on their own. The real leak they would have caught is caught
  better by INDIVIDUAL_PATTERNS above, which match an actual employee key, an
  actual email address and an actual identity number rather than the English
  word for one.
*/
const AMBIGUOUS_FIELD_WORDS = new Set(["name", "email", "individuals"]);

/*
  Validate a single step. Returns the list of problems, empty when it is fine.
  Every problem is reported rather than the first, so a drafter fixes one form
  once.
*/
export function validateStep(step, index = 0) {
  const errors = [];
  const where = `Step ${index + 1}`;
  const action = String(step?.action || "").trim();

  if (!action) {
    errors.push(`${where} needs an action.`);
  } else if (action.length < 10) {
    errors.push(`${where}: the action is too short to be a plan anyone could follow.`);
  }

  if (!STEP_OWNERS.includes(step?.owner)) {
    errors.push(
      `${where}: the owner must be one of ${STEP_OWNERS.join(", ")}. A playbook is read later by people who were not in the room, so a function owns a step, never a named person.`,
    );
  }

  if (!horizon(step?.horizon)) {
    errors.push(`${where} needs a horizon.`);
  }

  if (step?.measure && !MEASURES.some((m) => m.key === step.measure)) {
    errors.push(
      `${where}: "${step.measure}" is not a measure this platform reports, so nothing could close this step out.`,
    );
  }

  for (const hit of individualReferenceIn(action)) {
    errors.push(
      `${where} refers to ${hit}. A step addresses a cohort, never a person. Rewrite it for the group.`,
    );
  }

  for (const { term, reason } of refusedLanguageIn(action)) {
    errors.push(
      `${where} reads as ${reason} ("${term}"). Clinical absence data is not used for employment decisions, so this is outside what a playbook may propose.`,
    );
  }

  return errors;
}

/*
  Validate a whole playbook against the intervention it hangs off.

  The intervention is required: a playbook with no parent has no target, and a
  plan with no target is a plan aimed at everyone.
*/
export function validatePlaybook(playbook, { intervention } = {}) {
  const errors = [];

  if (!intervention) {
    errors.push("A playbook belongs to an intervention. Without one it has no target.");
  }

  if (!String(playbook?.title || "").trim()) {
    errors.push("A playbook needs a title.");
  }

  // A playbook must not carry a target of its own, even a correct one. The
  // point is that there is exactly one place a target is stated.
  if (playbook && "target" in playbook) {
    errors.push(
      "A playbook carries no target of its own: it inherits the intervention's, so a plan cannot reach a different group than the record it hangs off.",
    );
  }

  const steps = Array.isArray(playbook?.steps) ? playbook.steps : [];
  if (steps.length === 0) {
    errors.push("A playbook needs at least one step.");
  }
  if (steps.length > MAX_STEPS) {
    errors.push(
      `A playbook holds at most ${MAX_STEPS} steps. A longer list is a strategy document, and nobody closes one out.`,
    );
  }

  steps.forEach((step, i) => errors.push(...validateStep(step, i)));

  // At least one step has to be measurable, or there is no way to tell later
  // whether anything happened.
  if (steps.length && !steps.some((s) => MEASURES.some((m) => m.key === s.measure))) {
    errors.push(
      "At least one step must name a measure this platform reports, or the playbook cannot be closed out against anything.",
    );
  }

  return { ok: errors.length === 0, errors };
}

/*
  Parse an agent draft into steps.

  The prompt asks for one line per step, "STEP | action | owner | horizon |
  measure", and a WHY paragraph. Parsing is forgiving about spacing and case
  because a language model is, and strict about the fields because a step with a
  missing owner should arrive as an invalid step that validation reports, not as
  a step with an owner quietly invented for it.

  Anything the model wrote that is not a STEP line and not under WHY is dropped.
  A draft is a list of steps and a reason; prose around it is not part of the
  record, and keeping it would mean storing unvalidated text next to validated
  steps.
*/
export function parseDraft(text) {
  const lines = String(text || "").split(/\r?\n/);
  const steps = [];
  const why = [];
  let inWhy = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (/^why\b[:\s]/i.test(line) || /^why$/i.test(line)) {
      inWhy = true;
      const rest = line.replace(/^why\b[:\s]*/i, "").trim();
      if (rest) why.push(rest);
      continue;
    }

    if (/^step\s*\|/i.test(line)) {
      inWhy = false;
      const parts = line
        .replace(/^step\s*\|/i, "")
        .split("|")
        .map((p) => p.trim());
      const [action, owner, horizonKey, measureRaw] = parts;
      const measure = (measureRaw || "").toLowerCase();
      steps.push({
        action: action || "",
        owner: owner || "",
        horizon: (horizonKey || "").toLowerCase(),
        measure: !measure || measure === "none" ? null : measureRaw.trim(),
      });
      continue;
    }

    if (inWhy) why.push(line);
  }

  return { steps, why: why.join(" ").trim() };
}

/*
  The target a playbook operates on: the intervention's, always.
*/
export function playbookTarget(playbook, interventions) {
  const parent = (interventions || []).find((i) => i.id === playbook?.intervention_id);
  return parent ? parent.target || [] : [];
}

/*
  Whether this session may approve this playbook.

  Two conditions, and the second is the one that matters. Holding
  CONTROL_APPROVE is not enough: the drafter cannot approve their own plan, by
  identity and not only by role. The role table already keeps creation and
  approval apart, but roles are configuration and this is the invariant, so it
  is checked against the record rather than inferred from the permission.
*/
export function approvalBlockers(
  playbook,
  session,
  { hasApprovePermission, storeCanDecide = true } = {},
) {
  const blockers = [];

  if (!session) {
    blockers.push("no session");
    return blockers;
  }
  if (!hasApprovePermission) {
    blockers.push("this role may not approve playbooks");
  }
  /*
    Whether the store can record the decision at all. Not a domain rule: in this
    tenant the seeded playbooks are shared across visitors and already carry
    their decisions, so letting one walkthrough overwrite them would show the
    next visitor somebody else's choice. The store refuses it either way, and
    this is here so the interface does not offer a button that cannot work.
  */
  if (!storeCanDecide) {
    blockers.push("this playbook is shared and carries its decision already");
  }
  if (playbook?.drafted_by && playbook.drafted_by === session.email) {
    blockers.push("the drafter of a playbook cannot approve it");
  }
  if (playbook?.status === "Approved" || playbook?.status === "Rejected") {
    blockers.push(`this playbook is already ${String(playbook.status).toLowerCase()}`);
  }
  if (playbook?.status === "Superseded") {
    blockers.push("this playbook has been superseded");
  }

  return blockers;
}

export function canApprovePlaybook(playbook, session, opts) {
  return approvalBlockers(playbook, session, opts).length === 0;
}

/*
  What an outcome may say.

  A playbook that was run produces an observed difference against comparable
  cohorts over a fixed period. It does not produce proof that the plan caused
  the difference, and this is the function that refuses to let the interface
  phrase it that way.
*/
export function outcomeStatement(outcome) {
  if (!outcome || !outcome.measured) return null;
  const delta = Number(outcome.observed_days_per_head) - Number(outcome.baseline_days_per_head);
  const direction = delta < 0 ? "lower" : delta > 0 ? "higher" : "unchanged";
  const size = Math.abs(delta).toFixed(1);
  const comparators = (outcome.comparators || []).join(" and ");
  return {
    direction,
    size,
    text:
      direction === "unchanged"
        ? `Absence per head is unchanged against ${comparators || "comparable cohorts"} over the same period.`
        : `Absence per head is ${size} days ${direction} than baseline, against ${comparators || "comparable cohorts"} over the same period.`,
    caveat:
      "An observed difference between cohorts over a fixed period. It is not evidence that the playbook caused it, and nothing here tests for that.",
  };
}
