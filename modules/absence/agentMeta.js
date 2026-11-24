/*
  Client-safe agent metadata for the absence module: role tag, description and
  suggested questions. The system prompts and the API key live server side and
  are never imported here.

  Two agents, not three. The sick leave module has a Case Assistant because it
  has a case view: one record, for an occupational health clinician. The
  absence module has no such screen and no such data. Its module data is built
  from aggregates and carries no individual records at all, which is a
  guardrail the module states and a test enforces. An agent that reasons over
  one person cannot be mounted on a module that cannot name one, so it is
  absent rather than stubbed.
*/

export const AGENTS = {
  analyst: {
    id: "analyst",
    roleTag: "PORTFOLIO ANALYST",
    description:
      "Reads the covered workforce: where predicted absence and cost exposure concentrate, which cohorts carry the risk, and what the highest-leverage move is. Cohort level only, and it says which figures are modelled rather than measured.",
    chips: [
      "Where does absence exposure concentrate and why",
      "Which cohorts carry the most fatigue risk",
      "What is the highest leverage move available",
    ],
  },
  planner: {
    id: "planner",
    roleTag: "PLANNER",
    description:
      "Turns priced risk into proposals for a person to approve: what to change before next week's roster goes out, for the month ahead, or for the season. Prices each one and says how. Cohorts and departments only, never an individual.",
    chips: [
      "Where does the cover gap land hardest over the next 90 days",
      "Which cohorts carry the heaviest overtime load",
      "What does the return to work caseload require",
    ],
  },
};

/*
  The Reviewer lives on the Proposals screen rather than in this module's
  screens, but it is served by the same route, so it is declared here with the
  others.
*/
AGENTS.reviewer = {
  id: "reviewer",
  roleTag: "REVIEWER",
  description:
    "Measures finished proposals against comparable cohorts and drafts each outcome for a person to record. Sees what was predicted, not why, and says plainly when a proposal delivered less than it promised.",
  chips: [
    "Review the finished proposals",
    "Which finished proposal delivered least against its prediction",
  ],
};

export const AGENT_IDS = Object.keys(AGENTS);
