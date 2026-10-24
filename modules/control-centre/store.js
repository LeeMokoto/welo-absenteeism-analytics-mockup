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
