/*
  Agent route for the absence analytics module.

  The absence module declared three agents in its contract and mounted none, so
  the manifest promised a capability the screens did not have. This route and
  the two panels that call it are that promise met, minus the Case Assistant:
  the module holds no individual records, so an agent that reasons over one
  person has nothing to read and is not offered.

  The prompts are the shared ones in model/welo_inference/agent_prompts.json,
  the same file the Python service and the standalone dashboard use, rather
  than the sick-leave-specific prompts in modules/sick-leave/agentPrompts.js.
  Those name entitlement burn, ICD-10 chapter mix and a site-by-function
  matrix, none of which exist in this module's data. The shared ones are
  written for absence and cost exposure, which is what the grounding here
  carries.

  Everything that must behave identically across agent routes, the permission
  check, the no-key branch, the redaction on the error path, lives in
  lib/platform/agentHandler.js and is not restated here.
*/

import { createAgentHandler } from "@/lib/platform/agentHandler";
import { AGENT_IDS, AGENTS } from "@/modules/absence/agentMeta";
import { fallbackAnswer, refusal } from "@/modules/absence/agentFallback";
import { systemPromptFor, ABSENTEEISM_MODEL } from "@/app/api/absenteeism/_prompts";
import { toolsFor } from "@/modules/absence/agentTools";
import { portfolio } from "@/modules/absence/data/portfolio";
import { getManifest } from "@/lib/platform/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createAgentHandler({
  agents: AGENT_IDS,
  promptFor: systemPromptFor,
  fallback: {
    answer: fallbackAnswer,
    refusal,
    chipsFor: (agent) => AGENTS[agent]?.chips || [],
  },
  model: ABSENTEEISM_MODEL,
  modelEnvVar: "WELO_AGENT_MODEL",
  scope: "absence agent",
  /*
    Tools read the module data imported above, on the server. The panel still
    sends its grounding, which keeps the no-key fallback working, but with a
    key the agent can look figures up from the platform's own copy and the
    coordinator can draft a priced recommendation for a person to approve.
    No recommendations are stored in this tenant yet, so the track record
    starts empty and says so.
  */
  toolsFor: (agent) => toolsFor(agent, { canDraft: getManifest().modules.controlCentre }),
  toolContext: () => ({ portfolio, recommendations: [] }),
});
