/*
  Where recommendations are kept in this tenant: the visitor's browser.

  The same arrangement as playbooks and tasks in store.js. The real store will
  be a database inside the client's VPC; until then a recommendation an agent
  drafts is held in localStorage, and the interface says so. What is not mocked
  is the floor under it, which the real store will be built to:

  - a record that carries a person's identifier is refused, not cleaned;
  - a record cannot arrive already decided: only Drafted records are accepted
    from an agent, so a draft cannot be smuggled in as approved;
  - a status only moves forward, Drafted to Approved or Rejected, and Approved
    to Closed, and each move must carry what justifies it (the decision, or the
    measured outcome).

  Decisions and outcomes are authorised by the route in
  app/api/control-centre/recommendations, which returns the updated record.
  This store only accepts that record if the move is one the rules allow, so a
  path that skips the route cannot advance a record either.

  Examples ship with the screen so the full cycle can be seen with no agent key
  configured. They are built through the same functions a real draft goes
  through, marked `example: true`, and labelled as examples wherever they show.
*/

import { buildRecommendation, closeWithActual, decide } from "./recommendations.js";
import { carriesIndividual } from "./store.js";

const LOCAL_KEY = "welo.control-centre.recommendations.v1";

function readLocal() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
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

/*
  The examples. Fixed dates and ids, so the screen and the tests see the same
  records every time. Two closed cases is deliberately under the minimum, so
  the track record's "too few to judge" sentence is what a visitor sees first.
*/
const EXAMPLE_REQUESTER = "sipho.dlamini@example.com";
const EXAMPLE_APPROVER = { email: "naledi.khumalo@example.com", role: "approver", permissions: [] };

export function exampleRecommendations(context) {
  const make = (id, draft, created) => ({
    ...buildRecommendation(
      draft,
      {
        agent: "coordinator",
        requestedBy: EXAMPLE_REQUESTER,
        dataVersion: "example",
        trace: [
          { tool: "read_cover", input: {}, ok: true },
          { tool: "read_cohorts", input: { dimension: "operational_load" }, ok: true },
        ],
        now: new Date(created),
      },
      context,
    ),
    id,
    example: true,
  });
  const approve = (rec, at, note) =>
    decide(rec, { decision: "Approved", note, session: EXAMPLE_APPROVER, hasApprovePermission: true, now: new Date(at) });

  const standby = make(
    "rec-example-standby",
    {
      kind: "cover_booking",
      title: "Standby cover for high-intensity operations over month end",
      rationale:
        "Cover-gap days concentrate in the highest-load cohort, and its overtime is already high enough that asking for more adds to the fatigue driving the absence.",
      target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
      predicted: {
        saving_rand: 186000,
        cost_rand: 72000,
        basis: "Month-end cover-gap days for the cohort at the cover-day rate, less the agency premium for the standby shifts booked.",
        horizon_days: 30,
      },
    },
    "2026-11-16T07:30:00Z",
  );

  const roster = make(
    "rec-example-roster",
    {
      kind: "roster_change",
      title: "Cap runs of consecutive shifts in the critical fatigue band",
      rationale: "The critical fatigue band carries the highest predicted absence per head and the longest runs of consecutive shifts.",
      target: [{ dimension: "cohort_fatigue", cohort: "Critical" }],
      predicted: {
        saving_rand: 240000,
        cost_rand: 55000,
        basis: "Scenario run with two fewer consecutive shifts, priced at the day rate; cost is the extra headcount hours to cover the cap.",
        horizon_days: 90,
      },
    },
    "2026-10-20T09:00:00Z",
  );

  const campaign = make(
    "rec-example-campaign",
    {
      kind: "health_campaign",
      title: "Flu vaccination before the winter band for standard operations",
      rationale: "Respiratory absence rises from late May, and the standard-operations cohort is the largest the band reaches.",
      target: [{ dimension: "cohort_load", cohort: "Standard ops" }],
      predicted: {
        saving_rand: 310000,
        cost_rand: 95000,
        basis: "Last winter's respiratory absent days for the cohort, a benchmark uptake and effect, at the day rate.",
        horizon_days: 120,
      },
    },
    "2026-04-02T08:00:00Z",
  );

  const overtime = make(
    "rec-example-overtime",
    {
      kind: "review",
      title: "Review overtime allocation in high-intensity operations",
      rationale: "Overtime is concentrated in a cohort already above the fatigue threshold.",
      target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
      predicted: {
        saving_rand: 90000,
        cost_rand: 15000,
        basis: "Overtime hours moved to standard operations, priced at the cover premium avoided.",
        horizon_days: 60,
      },
    },
    "2026-06-01T08:00:00Z",
  );

  const agency = make(
    "rec-example-agency",
    {
      kind: "cover_booking",
      title: "Pre-book agency cover for the festive peak in light duty",
      rationale: "Light duty runs short every December, and agency rates rise once the peak is close.",
      target: [{ dimension: "cohort_load", cohort: "Light duty" }],
      predicted: {
        saving_rand: 120000,
        cost_rand: 64000,
        basis: "Last December's cover-gap days at the late-booking agency rate, against the early-booking rate.",
        horizon_days: 45,
      },
    },
    "2026-11-10T08:00:00Z",
  );

  return [
    standby,
    approve(roster, "2026-10-21T10:00:00Z", "Agreed with the shift managers; review after the quarter."),
    closeWithActual(approve(campaign, "2026-04-03T10:00:00Z", "Run with the occupational health team."), {
      saving_rand: 228000,
      basis: "Respiratory absent days against the comparable cohorts over the same winter, at the day rate.",
      now: new Date("2026-08-15T08:00:00Z"),
    }),
    closeWithActual(approve(overtime, "2026-06-02T10:00:00Z", "Proceed."), {
      saving_rand: 41000,
      basis: "Cover premium paid in the cohort against the previous two months.",
      now: new Date("2026-08-10T08:00:00Z"),
    }),
    decide(agency, {
      decision: "Rejected",
      note: "The group agency contract already fixes December rates, so early booking saves nothing.",
      session: EXAMPLE_APPROVER,
      hasApprovePermission: true,
      now: new Date("2026-11-11T09:00:00Z"),
    }),
  ].map((r) => ({ ...r, example: true }));
}

/*
  Examples overlaid with whatever this browser holds. A local record with an
  example's id is that example after a decision taken here, so it replaces the
  shipped one. Newest first.
*/
export function listRecommendations(context) {
  const local = readLocal();
  const ids = new Set(local.map((r) => r.id));
  const examples = exampleRecommendations(context).filter((r) => !ids.has(r.id));
  return [...local, ...examples].sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

/*
  Keep the drafts an agent returned. Each is checked again here: the agent's
  response crossed the network, so it is input like any other.
*/
export function saveDrafts(drafts) {
  const existing = readLocal();
  const saved = [];
  const refused = [];
  for (const d of drafts || []) {
    if (carriesIndividual(d)) {
      refused.push({ id: d?.id, reason: "A recommendation cannot carry a person's identifier." });
      continue;
    }
    if (d?.status !== "Drafted" || d?.decision || d?.actual) {
      refused.push({ id: d?.id, reason: "Only an undecided draft can be saved from an agent." });
      continue;
    }
    if (!d?.id || existing.some((r) => r.id === d.id) || saved.some((r) => r.id === d.id)) {
      refused.push({ id: d?.id, reason: "This draft is already saved." });
      continue;
    }
    saved.push({ ...d, example: false });
  }
  const persisted = saved.length ? writeLocal([...existing, ...saved]) : true;
  return { saved, refused, persisted };
}

const MOVES = {
  Drafted: ["Approved", "Rejected"],
  Approved: ["Closed"],
};

/*
  Replace a record with the one the route returned. Refused unless the status
  moves forward by one allowed step and carries what justifies the move.
*/
export function applyUpdate(current, updated) {
  if (!current || !updated || current.id !== updated.id) {
    return { ok: false, reason: "That is not the same recommendation." };
  }
  if (carriesIndividual(updated)) {
    return { ok: false, reason: "A recommendation cannot carry a person's identifier." };
  }
  if (!(MOVES[current.status] || []).includes(updated.status)) {
    return { ok: false, reason: `A ${current.status.toLowerCase()} recommendation cannot become ${String(updated.status).toLowerCase()}.` };
  }
  if ((updated.status === "Approved" || updated.status === "Rejected") && !updated.decision?.by) {
    return { ok: false, reason: "A decision must say who made it." };
  }
  if (updated.status === "Closed" && typeof updated.actual?.saving_rand !== "number") {
    return { ok: false, reason: "A closed recommendation must carry its measured outcome." };
  }
  // The parts an approver or operator never changes stay as drafted.
  for (const field of ["kind", "title", "rationale", "requested_by", "created"]) {
    if (JSON.stringify(current[field]) !== JSON.stringify(updated[field])) {
      return { ok: false, reason: `The ${field.replace("_", " ")} cannot change after drafting.` };
    }
  }
  if (JSON.stringify(current.target) !== JSON.stringify(updated.target)) {
    return { ok: false, reason: "The target cannot change after drafting." };
  }
  if (JSON.stringify(current.predicted) !== JSON.stringify(updated.predicted)) {
    return { ok: false, reason: "The prediction cannot change after drafting, or the track record means nothing." };
  }

  const local = readLocal().filter((r) => r.id !== updated.id);
  const persisted = writeLocal([...local, { ...updated, example: Boolean(current.example) }]);
  return { ok: true, record: updated, persisted };
}

export function clearLocalRecommendations() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* nothing to clear */
  }
}
