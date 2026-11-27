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
import { freezeComparators } from "./outcomes.js";
import { storageKey } from "../../lib/platform/tenantScope.js";

const LOCAL_KEY = "welo.control-centre.recommendations.v1";

function readLocal() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(LOCAL_KEY));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(records) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(storageKey(LOCAL_KEY), JSON.stringify(records));
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

/*
  The shipped examples, per tenant. Each set shows the whole cycle: a draft
  waiting for a decision, approved proposals still running, one finished and
  waiting for the Reviewer, closed ones that feed the track record, and a
  rejection with its reason. Approved examples carry comparators frozen at
  approval, as the route does, so the Reviewer can measure them.
*/
export function exampleRecommendations(context = {}) {
  return context.tenant === "hospitality" ? hospitalityExamples(context) : baseExamples(context);
}

function exampleHelpers(context) {
  const make = (id, draft, created, trace) => ({
    ...buildRecommendation(
      draft,
      {
        agent: "planner",
        requestedBy: EXAMPLE_REQUESTER,
        dataVersion: "example",
        trace: trace || [
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
    decide(rec, {
      decision: "Approved",
      note,
      session: EXAMPLE_APPROVER,
      hasApprovePermission: true,
      comparators: rec.target.length === 1 ? freezeComparators(rec.target[0], context.cohorts) : undefined,
      now: new Date(at),
    });
  const reject = (rec, at, note) =>
    decide(rec, { decision: "Rejected", note, session: EXAMPLE_APPROVER, hasApprovePermission: true, now: new Date(at) });
  return { make, approve, reject };
}

function baseExamples(context) {
  const { make, approve } = exampleHelpers(context);

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
    // Finished and waiting for the Reviewer: the roster change the cohort
    // series simulates from April.
    approve(
      make(
        "rec-example-hours",
        {
          kind: "roster_change",
          horizon: "season",
          title: "Cut overtime and cap consecutive shifts in high-intensity operations",
          rationale:
            "The highest-load cohort carries the most overtime and the longest runs of shifts, and both feed the fatigue the model reads.",
          target: [{ dimension: "cohort_load", cohort: "High-intensity ops" }],
          predicted: {
            saving_rand: 2600000,
            cost_rand: 900000,
            basis: "What-if run with overtime down 28% and consecutive shifts capped at 8, at the day rate over the season.",
            horizon_days: 180,
          },
        },
        "2026-03-25T08:00:00Z",
      ),
      "2026-03-26T10:00:00Z",
      "Agreed with the shift managers from April.",
    ),
  ].map((r) => ({ ...r, example: true }));
}

/*
  The hospitality group. Departments throughout, priced at its own day rate.
  The Kitchen roster fix is the change the hospitality cohort series simulates
  from April, so the Reviewer has a real difference to measure; it was
  predicted to save more than the data shows, which is the case worth seeing.
*/
function hospitalityExamples(context) {
  const { make, approve, reject } = exampleHelpers(context);
  const trace = [
    { tool: "read_staffing_cost", input: {}, ok: true },
    { tool: "read_cohorts", input: { dimension: "department" }, ok: true },
  ];

  const kitchen = make(
    "rec-example-kitchen-roster",
    {
      kind: "roster_change",
      horizon: "season",
      title: "Keep 12 hours between Kitchen shifts and cut late closes",
      rationale:
        "The Kitchen has the most short rests and late finishes of any department, and an uncovered Kitchen shift loses the most revenue.",
      target: [{ dimension: "cohort_department", cohort: "Kitchen" }],
      predicted: {
        saving_rand: 2400000,
        cost_rand: 380000,
        basis: "What-if run with short rests removed and late finishes halved, at the day rate over the season. Cost is the extra closing cover.",
        horizon_days: 180,
      },
    },
    "2026-03-25T08:00:00Z",
    trace,
  );
  const easter = make(
    "rec-example-easter-cover",
    {
      kind: "cover_booking",
      horizon: "month",
      title: "Pre-book front desk agency cover for the Easter weekend",
      rationale: "Front office absence rises over long weekends, when occupancy is highest and late booking costs most.",
      target: [{ dimension: "cohort_department", cohort: "Front office" }],
      predicted: {
        saving_rand: 70000,
        cost_rand: 28000,
        basis: "Last Easter's uncovered front desk shifts at the late-booking agency rate, against the early rate.",
        horizon_days: 30,
      },
    },
    "2026-03-10T08:00:00Z",
    trace,
  );
  const pool = make(
    "rec-example-room-pool",
    {
      kind: "hiring_plan",
      horizon: "season",
      title: "Build a casual room attendant pool for the December peak",
      rationale: "Housekeeping is forecast to cost more than usual over the next 90 days, and agency room attendants are scarce in December.",
      target: [{ dimension: "cohort_department", cohort: "Housekeeping" }],
      predicted: {
        saving_rand: 610000,
        cost_rand: 240000,
        basis: "Forecast short Housekeeping shifts over 90 days at the cover rate, less the cost of recruiting and training the pool.",
        horizon_days: 90,
      },
    },
    "2026-11-05T08:00:00Z",
    trace,
  );
  const floor = make(
    "rec-example-floor-standby",
    {
      kind: "cover_booking",
      horizon: "month",
      title: "Standby floor cover for December Friday and Saturday dinners",
      rationale: "Front of house carries the most value at risk in December, and dinner is the service that runs short most often.",
      target: [{ dimension: "cohort_department", cohort: "Front of house" }],
      predicted: {
        saving_rand: 420000,
        cost_rand: 160000,
        basis: "Forecast short dinner shifts on December weekends at the revenue lost per short shift, less the standby cost.",
        horizon_days: 45,
      },
    },
    "2026-11-20T08:00:00Z",
    trace,
  );
  const fourDay = make(
    "rec-example-four-day",
    {
      kind: "roster_change",
      horizon: "season",
      title: "Move Support and admin to a four-day week",
      rationale: "Support and admin has spare capacity on Fridays and the lowest cover share.",
      target: [{ dimension: "cohort_department", cohort: "Support and admin" }],
      predicted: {
        saving_rand: 95000,
        cost_rand: 30000,
        basis: "Friday cover not bought, at the cover rate.",
        horizon_days: 120,
      },
    },
    "2026-10-02T08:00:00Z",
    trace,
  );

  return [
    floor,
    approve(pool, "2026-11-06T10:00:00Z", "Start recruiting now; review in February."),
    approve(kitchen, "2026-03-26T10:00:00Z", "Agreed with the head chefs from April."),
    closeWithActual(approve(easter, "2026-03-11T10:00:00Z", "Book it."), {
      saving_rand: 52000,
      basis: "Agency invoices for the weekend against last Easter's late-booking rates.",
      now: new Date("2026-05-02T08:00:00Z"),
    }),
    reject(fourDay, "2026-10-03T09:00:00Z", "Support and admin covers the front desk on Fridays, so the saving is not real."),
  ].map((r) => ({ ...r, example: true }));
}

/*
  Examples overlaid with whatever this browser holds. A local record with an
  example's id is that example after a decision taken here, so it replaces the
  shipped one. Newest first.
*/
/* The records this browser holds, without the shipped examples. */
export function localRecommendations() {
  return readLocal();
}

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
    window.localStorage.removeItem(storageKey(LOCAL_KEY));
  } catch {
    /* nothing to clear */
  }
}
