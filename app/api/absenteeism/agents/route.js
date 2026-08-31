/*
  Availability probe for the absenteeism dashboard's agents.

  The static dashboard (config/agents.js) calls GET {base}/agents once on load
  and enables its AI panels when this reports available. Shape must match what
  the FastAPI service returns, since the same client talks to both:
    { available: bool, model: string, agents: string[] }

  The key is read server side only and never reaches the browser.
*/

import { ABSENTEEISM_AGENT_IDS, ABSENTEEISM_MODEL } from "../_prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
