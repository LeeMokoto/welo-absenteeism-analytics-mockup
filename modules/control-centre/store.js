/*
  The actions store, mocked.

  The real one, per the solution design, is Cloud SQL for PostgreSQL inside the
  tenant perimeter under the tenant's keys. This demo tenant has no VPC, so
  there is nothing to put a private database inside, and provisioning one would
  pull a VPC, private connectivity, CMEK and backups into a deployment that
  exists to show the product. So: a mock.

  It is a mock that says so. Seeded records are shared and always present, so a
  walkthrough has something to look at. Records created during a walkthrough are
  held in the browser, so they survive navigation and are gone on the next
  visitor, and the interface states that rather than letting someone believe
  they filed something durable.

  What is NOT mocked is the shape. Every record refers to a cohort and carries
  no employee key, because that is the control, not an implementation detail,
  and the schema is what the real store will be built to. A test asserts it.

  Replacing this with Cloud SQL should change this file and nothing above it.
*/

export const STORE_KIND = "mock";

// Where a walkthrough's own records live. Browser-local on purpose: no server
// state means no accidental impression of durability.
const LOCAL_KEY = "welo.control-centre.interventions.v1";

export const STATUSES = ["Proposed", "Approved", "Running", "Measuring", "Closed"];

/*
  Seeded records. Cohort-level throughout, and deliberately showing the three
  states a reviewer should see: something proposed and not yet approved,
  something running, and something measured with an honest outcome.
*/
const SEEDED = [
  {
    id: "icv-001",
    title: "Rostering review for high-intensity operations",
    target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
    headcount: 2030,
    owner: "Operations lead",
    created: "2026-08-14",
    due: "2026-11-30",
    status: "Measuring",
    rationale:
      "Highest absence per head and the cohort where rostering is a lever Welo can actually pull. Consecutive-shift caps and a rest-day floor, applied to the whole cohort.",
    outcome: {
      measured: true,
      baseline_days_per_head: 18.7,
      observed_days_per_head: 17.9,
      comparators: ["Standard ops", "Light duty"],
      note:
        "An observed difference against comparable cohorts over the same fixed period. Not proof the change caused it.",
    },
  },
  {
    id: "icv-002",
    title: "Fatigue screening clinic, critical band",
    target: [{ dimension: "cohort_fatigue", cohort: "Critical" }],
    headcount: null,
    owner: "Occupational health",
    created: "2026-09-02",
    due: "2026-12-15",
    status: "Running",
    rationale:
      "The strongest single driver in the model. Offer screening to the cohort and route anyone who wants it into the existing care pathway.",
    outcome: null,
  },
  {
    id: "icv-003",
    title: "Return-to-work conversations for new starters",
    target: [{ dimension: "cohort_tenure", cohort: "New (<2y)" }],
    headcount: null,
    owner: "HR business partner",
    created: "2026-10-11",
    due: null,
    status: "Proposed",
    rationale:
      "Onboarding strain shows in the first two years. A structured return-to-work conversation is a support step, not an attendance one.",
    outcome: null,
  },
];

/*
  Seeded alert rules. Deliberately includes one scoped to a whole dimension, so
  a walkthrough sees what happens when a rule meets a cohort it cannot
  evaluate.
*/
const SEEDED_RULES = [
  {
    id: "rule-001",
    name: "Elevated risk concentration",
    measure: "high_or_critical_share",
    comparison: "above",
    threshold: 0.2,
    scope: { dimension: "cohort_load" },
    owner: "Operations lead",
    enabled: true,
  },
  {
    id: "rule-002",
    name: "Fatigue running hot",
    measure: "mean_fatigue",
    comparison: "above",
    threshold: 65,
    scope: { dimension: "cohort_fatigue" },
    owner: "Occupational health",
    enabled: true,
  },
  {
    id: "rule-003",
    name: "Absence load on new starters",
    measure: "absent_days_per_head_annual",
    comparison: "above",
    threshold: 12,
    scope: { dimension: "cohort_tenure", cohort: "New (<2y)" },
    owner: "HR business partner",
    enabled: true,
  },
];

/*
  Seeded playbooks. Three states on purpose, because the states are the point of
  the screen: one approved by somebody who did not draft it, one waiting for a
  decision, and one rejected with the reason recorded.

  The rejected one is the most useful thing on the screen. It is an agent draft
  that proposed a disciplinary step, which the platform refused and a human
  then rejected, and it is kept rather than deleted so the record shows that the
  refusal happened. A control nobody can see working is hard to believe in.
*/
const SEEDED_PLAYBOOKS = [
  {
    id: "pb-001",
    intervention_id: "icv-001",
    title: "Playbook for Rostering review for high-intensity operations",
    status: "Approved",
    drafted_by: "sipho.dlamini@example.com",
    drafted_by_role: "analyst",
    drafted_with: "agent",
    drafted_at: "2026-08-15",
    why:
      "The cohort carries 18.7 absent days per head against 8.2 for the lightest band, and consecutive shifts and overtime are the two inputs the roster controls directly.",
    steps: [
      {
        action: "Cap consecutive shifts at eight across the cohort and hold a rest-day floor of two in fourteen.",
        owner: "Shift scheduling",
        horizon: "immediate",
        measure: "absent_days_per_head_annual",
      },
      {
        action: "Move the relief pool to cover the two sites carrying the largest cover gap before overtime is offered.",
        owner: "Operations lead",
        horizon: "short",
        measure: "absent_days_per_head_annual",
      },
      {
        action: "Review the roster change with the cohort's shift leads each quarter and keep or revert it on the measure.",
        owner: "Operations lead",
        horizon: "sustained",
        measure: "mean_fatigue",
      },
    ],
    approval: {
      by: "naledi.khumalo@example.com",
      by_role: "approver",
      at: "2026-08-18",
      decision: "approved",
      note: "Rostering change only, no individual follow up. Approved for the cohort.",
    },
  },
  {
    id: "pb-002",
    intervention_id: "icv-002",
    title: "Playbook for Fatigue screening clinic, critical band",
    status: "In review",
    drafted_by: "sipho.dlamini@example.com",
    drafted_by_role: "analyst",
    drafted_with: "agent",
    drafted_at: "2026-09-03",
    why:
      "Fatigue is the strongest single driver in the model, and this band sits at a mean score of 71.9 against a cohort mean of 57.",
    steps: [
      {
        action: "Offer fatigue and sleep screening to the whole band through the on-site clinic, opt in, during shift hours.",
        owner: "Occupational health",
        horizon: "immediate",
        measure: "mean_fatigue",
      },
      {
        action: "Route anyone who wants it into the existing medical aid care pathway, with no report back to the line.",
        owner: "Occupational health",
        horizon: "short",
        measure: null,
      },
      {
        action: "Brief shift leads on the rest-day floor and on what they may and may not ask about a screening.",
        owner: "Health and safety",
        horizon: "immediate",
        measure: null,
      },
    ],
    approval: null,
  },
  {
    id: "pb-003",
    intervention_id: "icv-003",
    title: "Playbook for Return-to-work conversations for new starters",
    status: "Rejected",
    drafted_by: "sipho.dlamini@example.com",
    drafted_by_role: "analyst",
    drafted_with: "agent",
    drafted_at: "2026-10-12",
    why:
      "Onboarding strain shows in the first two years, at 11.9 absent days per head against 12.1 across all tenure bands, so the case rests on the shape of the spells rather than the total.",
    steps: [
      {
        action: "Offer a structured, voluntary return-to-work conversation focused on support and workload.",
        owner: "HR business partner",
        horizon: "short",
        measure: "absent_days_per_head_annual",
      },
      {
        action: "Where absence continues after the conversation, begin a disciplinary process in line with policy.",
        owner: "HR business partner",
        horizon: "short",
        measure: null,
      },
    ],
    approval: {
      by: "naledi.khumalo@example.com",
      by_role: "approver",
      at: "2026-10-13",
      decision: "rejected",
      note:
        "Step 2 is a disciplinary process attached to clinical absence data, which the platform refused at drafting and which is not something this programme does. Redraft without it.",
    },
  },
];

export function seededPlaybooks() {
  return SEEDED_PLAYBOOKS.map((p) => ({ ...p, source: "seeded" }));
}

export function seededRules() {
  return SEEDED_RULES.map((r) => ({ ...r, source: "seeded" }));
}

export function seeded() {
  return SEEDED.map((r) => ({ ...r, source: "seeded" }));
}

function readLocal() {
  // Browser storage throws in a private window and returns nothing when the
  // visitor has cleared it, so every read is guarded and an empty result is a
  // normal outcome rather than an error.
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((r) => ({ ...r, source: "local" })) : [];
  } catch {
    return [];
  }
}

function writeLocal(records) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

export function listInterventions() {
  return [...seeded(), ...readLocal()];
}

// Playbooks drafted during a walkthrough, held in the same browser-local way as
// interventions and for the same reason.
const LOCAL_PLAYBOOKS_KEY = "welo.control-centre.playbooks.v1";

function readLocalPlaybooks() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_PLAYBOOKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((p) => ({ ...p, source: "local" })) : [];
  } catch {
    return [];
  }
}

function writeLocalPlaybooks(records) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(LOCAL_PLAYBOOKS_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

export function listPlaybooks() {
  return [...seededPlaybooks(), ...readLocalPlaybooks()];
}

/*
  Save a drafted playbook. Status is forced to Drafted and approval to null
  whatever the caller passed: a playbook cannot be created already approved,
  because then nothing was approved by anybody.
*/
export function createPlaybook(playbook) {
  const clean = stripIndividualFields(playbook);
  const saved = {
    ...clean,
    id: `pb-local-${Date.now().toString(36)}`,
    status: "Drafted",
    approval: null,
    source: "local",
  };
  const persisted = writeLocalPlaybooks([
    ...readLocalPlaybooks().map(({ source, ...p }) => p),
    { ...saved, source: undefined },
  ]);
  return { record: saved, persisted };
}

/*
  Record a decision on a playbook.

  Only local playbooks can be decided in this tenant: the seeded ones are shared
  and already carry their decisions, and letting a walkthrough overwrite them
  would mean the next visitor sees somebody else's choice. The caller checks
  permission and the drafter rule first; this refuses a seeded record and an
  already-decided one, so neither depends on the interface getting it right.
*/
export function decidePlaybook(id, { decision, note, by, byRole }) {
  if (!["approved", "rejected"].includes(decision)) {
    return { ok: false, reason: "A decision is either approved or rejected." };
  }
  const local = readLocalPlaybooks();
  const target = local.find((p) => p.id === id);
  if (!target) {
    return {
      ok: false,
      reason:
        "Only playbooks drafted in this browser can be decided here. The seeded ones carry their decisions already.",
    };
  }
  if (target.approval) {
    return { ok: false, reason: "This playbook has already been decided." };
  }

  const updated = local.map((p) =>
    p.id === id
      ? {
          ...p,
          status: decision === "approved" ? "Approved" : "Rejected",
          approval: {
            by,
            by_role: byRole,
            at: new Date().toISOString().slice(0, 10),
            decision,
            note: note || "",
          },
        }
      : p,
  );

  const persisted = writeLocalPlaybooks(updated.map(({ source, ...p }) => p));
  return { ok: true, persisted };
}

export function clearLocalPlaybooks() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_PLAYBOOKS_KEY);
  } catch {
    /* nothing to clear */
  }
}

/*
  Create a record. The caller validates the target against the targeting rules
  first; this refuses anything carrying a person because a store that accepts
  one is a store that will eventually hold one.
*/
export function createIntervention(record) {
  const clean = stripIndividualFields(record);
  const now = new Date().toISOString().slice(0, 10);
  const saved = {
    ...clean,
    id: `icv-local-${Date.now().toString(36)}`,
    created: now,
    status: clean.status || "Proposed",
    outcome: null,
    source: "local",
  };
  const persisted = writeLocal([...readLocal().map(({ source, ...r }) => r), { ...saved, source: undefined }]);
  return { record: saved, persisted };
}

export function clearLocal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* nothing to clear */
  }
}

/*
  Fields that would make a record about a person rather than a cohort. Stripped
  rather than rejected, so a caller passing one by accident gets a correct
  record instead of an error it might swallow.
*/
export const INDIVIDUAL_FIELDS = [
  "employee_key",
  "employee_id",
  "employee_number",
  "name",
  "id_number",
  "email",
  "individuals",
];

export function stripIndividualFields(record) {
  const out = { ...(record || {}) };
  for (const field of INDIVIDUAL_FIELDS) delete out[field];
  return out;
}

export function carriesIndividual(record) {
  return INDIVIDUAL_FIELDS.some((f) => f in (record || {}));
}
