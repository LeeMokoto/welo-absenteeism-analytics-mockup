/*
  Client-safe agent metadata: role tag, description and suggested chips only.
  The system prompts and the API key live server-side in the agent route and
  are never imported here.
*/

export const AGENTS = {
  analyst: {
    id: "analyst",
    roleTag: "PORTFOLIO ANALYST",
    description:
      "Reads the whole covered workforce: where sick leave and cost concentrate, which cohorts carry it, and the highest-leverage move. Cohort level only.",
    chips: [
      "Where is sick leave cost concentrating and why",
      "Which cohorts are closest to exhausting entitlement",
      "What is the highest leverage intervention available this quarter",
    ],
  },
  case: {
    id: "case",
    roleTag: "CASE ASSISTANT",
    description:
      "Supports an occupational health clinician on one record. Drafts short, supportive, non-punitive return-to-work and care plans. Never used for review or discipline.",
    chips: [
      "Draft a support plan for this record",
      "What occupational health steps fit the top drivers",
      "Which medical aid pathways apply here",
    ],
  },
  coordinator: {
    id: "coordinator",
    roleTag: "COVER AND ROSTER COORDINATOR",
    description:
      "Turns cover-gap, overtime and entitlement forecasts into concrete staffing actions. Cohort, site and shift level only, never an individual.",
    chips: [
      "Where does the cover gap land hardest over the next four weeks",
      "What relief pool change would cut overtime cost most",
      "Which cohorts should we plan for on entitlement exhaustion",
    ],
  },
};

export const AGENT_IDS = Object.keys(AGENTS);
