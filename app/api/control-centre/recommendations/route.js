/*
  Deciding and closing a recommendation.

  The same split as the interventions route: the store is mocked and
  browser-local, so this route persists nothing, but the authorisation and the
  rules are real and run here. The client calls this first and keeps the
  returned record only on a 200.

  Two actions:

  - `decide`: approve or reject. Needs CONTROL_APPROVE, and the person who
    asked the agent for the draft cannot decide it. An agent never reaches this
    route at all: no tool calls it.
  - `close`: record the delivered saving once the horizon has passed. Needs
    CONTROL_CREATE, because measuring is the operator's job, not the
    approver's.

  The record arrives from the browser, so it is validated again here rather
  than trusted. A record that carries a person's identifier is refused, not
  cleaned.
*/

import { requirePermission } from "@/lib/platform/session";
import { PERMISSIONS, can } from "@/lib/platform/roles";
import { carriesIndividual } from "@/modules/control-centre/store";
import { validateRecommendation, decide, closeWithActual } from "@/modules/control-centre/recommendations";
import { getPortfolio } from "@/lib/platform/tenantContext";
import { freezeComparators } from "@/modules/control-centre/outcomes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error, status = 400) => Response.json({ error }, { status });

export async function POST(request) {
  const portfolio = await getPortfolio();
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body was not valid JSON.");
  }

  const { action, recommendation: rec } = body || {};
  const needed = action === "decide" ? PERMISSIONS.CONTROL_APPROVE : action === "close" ? PERMISSIONS.CONTROL_CREATE : null;
  if (!needed) return bad("action must be decide or close.");

  const { session, allowed } = await requirePermission(needed);
  if (!allowed) {
    return bad(
      action === "decide" ? "This role may not approve or reject recommendations." : "This role may not close recommendations.",
      403,
    );
  }

  if (!rec || typeof rec !== "object") return bad("A recommendation is required.");
  if (carriesIndividual(rec)) return bad("A recommendation cannot carry a person's identifier.", 422);

  const check = validateRecommendation(
    rec,
    { dimensions: portfolio.cohort_dimensions, cohorts: portfolio.cohorts },
  );
  if (!check.ok) return Response.json({ error: "The recommendation is not valid.", errors: check.errors }, { status: 422 });

  try {
    const updated =
      action === "decide"
        ? decide(rec, {
            decision: body.decision,
            note: body.note,
            session,
            hasApprovePermission: can(session, PERMISSIONS.CONTROL_APPROVE),
            // Frozen at approval for the Reviewer to measure against later.
            comparators:
              (rec.target || []).length === 1 ? freezeComparators(rec.target[0], portfolio.cohorts) : undefined,
          })
        : closeWithActual(rec, { saving_rand: body.saving_rand, basis: body.basis });
    return Response.json({ recommendation: updated });
  } catch (err) {
    return bad(String(err?.message || err), 409);
  }
}
