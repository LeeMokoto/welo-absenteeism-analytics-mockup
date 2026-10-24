/*
  Authorisation and validation for writing an intervention record.

  The store is mocked and browser-local, so there is no server to persist to.
  That is not a reason to have no server-side check. The solution design puts
  the role check in the API so a hidden button is never the only control, and
  before this route existed creation was gated on CONTROL_VIEW, which the
  Approver holds. The role whose entire purpose is to approve what it did not
  create could create.

  So the split is the same one the mocked sign-in uses: the storage is fake, the
  authorisation and the validation are real and run here. The client calls this
  first, and persists locally only on a 200. A caller that skips the route can
  still write to its own browser storage, and that is the honest limit of a
  mocked store: nothing it writes leaves that browser or reaches another
  visitor. When the store becomes Cloud SQL, the persistence moves into this
  handler and nothing above it changes.
*/

import { requirePermission } from "@/lib/platform/session";
import { PERMISSIONS } from "@/lib/platform/roles";
import { getManifest } from "@/lib/platform/manifest";
import { canSaveIntervention } from "@/modules/control-centre/targeting";
import { freezeComparators } from "@/modules/control-centre/outcomes";
import { carriesIndividual, stripIndividualFields } from "@/modules/control-centre/store";
import { portfolio } from "@/modules/absence/data/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const { session, allowed } = await requirePermission(PERMISSIONS.CONTROL_CREATE);
  if (!allowed) {
    return Response.json(
      { error: "This role may not create intervention records." },
      { status: 403 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body was not valid JSON." }, { status: 400 });
  }

  const record = body?.record;
  if (!record || typeof record !== "object") {
    return Response.json({ error: "A record is required." }, { status: 400 });
  }

  /*
    A record carrying an employee key is refused outright rather than stripped.
    The store strips, because a caller that passes one by accident should still
    get a correct record. The API refuses, because a caller that passes one over
    the wire is asking for something this product does not do, and quietly
    accepting a cleaned version of it teaches the caller that it worked.
  */
  if (carriesIndividual(record)) {
    return Response.json(
      {
        error:
          "An intervention record refers to a cohort, never a person. The request carried an individual identifier.",
      },
      { status: 422 },
    );
  }

  const manifest = getManifest();
  const check = canSaveIntervention(record.target, {
    dimensions: portfolio.cohort_dimensions || [],
    cohorts: portfolio.cohorts || {},
    suppressionThreshold: manifest.suppressionThreshold,
  });

  if (!check.ok) {
    return Response.json({ error: check.errors.join(" "), errors: check.errors }, { status: 422 });
  }

  if (!String(record.title || "").trim()) {
    return Response.json({ error: "A record needs a title." }, { status: 422 });
  }

  /*
    The authorised, validated record goes back for the client to persist. The
    creator is stamped here rather than taken from the body, so a record cannot
    claim to have been drafted by somebody else, which is what the separation of
    creation from approval rests on.
  */
  /*
    Comparators are chosen here, once, and never again.

    They are the other reportable cohorts of the same dimension as they stand
    at this moment. Choosing them later, when the result is known, means
    choosing the ones that flatter it, and nobody doing that experiences
    themselves as cheating. Freezing them on the record at creation is the
    pre-registration principle, and it is why the measurement this enables is
    worth reading at all.

    A caller-supplied comparators field is ignored rather than honoured: the
    whole control is that the client does not get to pick them.
  */
  const target = (record.target || [])[0];
  const comparators = freezeComparators(target, portfolio.cohorts || {});

  const created = new Date().toISOString().slice(0, 10);

  return Response.json({
    record: {
      ...stripIndividualFields(record),
      created,
      created_by_role: session.role,
      created_by: session.email,
      headcount: check.headcount,
      needs_headcount_confirmation: check.needsConfirmation,
      comparators,
      comparators_frozen_at: created,
    },
    store: "mock",
    note: "Authorised and validated server side. Comparators frozen at creation. Persistence is browser-local in this tenant.",
    comparators_note:
      comparators.length === 0
        ? "No other cohort of this dimension is reportable, so no comparator could be frozen. This intervention will not be measurable, and the platform will say so rather than comparing it against cohorts chosen later."
        : `Frozen against ${comparators.join(" and ")}. These cannot be changed afterwards.`,
  });
}
