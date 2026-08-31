/*
  Absenteeism agent prompts, read from the SAME file the Python inference
  service reads (model/welo_inference/agent_prompts.json). Both deployments
  therefore enforce identical guardrails: the no-disciplinary-use, synthetic
  framing, Rand and no-dashes rules are the compliance position, so a second
  hand-copied set of prompts here would be a governance risk, not just
  duplication.

  To change agent behaviour, edit that JSON. Never copy the text into this file.
*/

import prompts from "@/model/welo_inference/agent_prompts.json";

export const ABSENTEEISM_AGENT_IDS = Object.keys(prompts.roles);

// Matches the Python service default (WELO_AGENT_MODEL) so the two deployments
// answer alike; override per environment with WELO_AGENT_MODEL on Vercel.
export const ABSENTEEISM_MODEL =
  process.env.WELO_AGENT_MODEL || "claude-opus-4-8";

export function systemPromptFor(agent) {
  const role = prompts.roles[agent];
  if (!role) return null;
  return prompts.guardrails + "\n\n" + role;
}

// The grounding arrives from the browser, which holds the model output the
// dashboard is already displaying. Present it the same way the Python service
// does: data first, then the question.
export function userContent(question, data) {
  const json = JSON.stringify(data ?? {}, null, 2);
  return (
    "DATA (Welo model output for this cohort):\n" +
    "```json\n" +
    json +
    "\n```\n\n" +
    "REQUEST:\n" +
    String(question || "").trim()
  );
}

export const MAX_TOKENS = 1500;
