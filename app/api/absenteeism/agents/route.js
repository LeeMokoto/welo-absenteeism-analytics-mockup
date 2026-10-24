/*
  Availability probe for the absenteeism dashboard's agents.

  The static dashboard (config/agents.js) calls GET {base}/agents once on load
  and enables its AI panels when this reports available. Shape must match what
  the FastAPI service returns, since the same client talks to both:
    { available: bool, model: string, agents: string[] }

  The key is read server side only and never reaches the browser.
*/

import { ABSENTEEISM_AGENT_IDS, ABSENTEEISM_MODEL } from "../_prompts";
import { requirePermission } from "@/lib/platform/session";
import { PERMISSIONS } from "@/lib/platform/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // The solution design puts the role check in the API, so a hidden menu item
  // is never the only control. A caller with a session that may not use the
  // agents is refused here even though the panel is not rendered for them.
  {
    const { allowed } = await requirePermission(PERMISSIONS.USE_AGENTS);
    if (!allowed) {
      return Response.json({ error: "This role may not use the agents." }, { status: 403 });
    }
  }

  const available = Boolean(process.env.ANTHROPIC_API_KEY);
  return Response.json(
    {
      available,
      model: available ? ABSENTEEISM_MODEL : null,
      agents: ABSENTEEISM_AGENT_IDS,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
