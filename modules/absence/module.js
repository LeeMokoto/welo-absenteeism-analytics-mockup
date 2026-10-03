/*
  Module definition: absence analytics.

  Ported from the original standalone dashboard. The portfolio screen runs in
  the shell; the remaining screens are still served by the standalone build and
  are marked `external` so the shell renders them as a departure rather than
  pretending they are in the frame. As each is ported, its entry loses the flag
  and nothing else changes.
*/

export const absenceModule = {
  id: "absence",
  label: "Absence analytics",
  summary:
    "Predicted absence, fatigue and cost exposure across the covered workforce, with live what-if scoring against the trained model.",
  enabledBy: "absence",
  home: "/absence",
  screens: [
    { href: "/absence", label: "Portfolio and cohorts" },
    { href: "/absenteeism/index.html#cohorts", label: "Cohorts", external: true },
    { href: "/absenteeism/index.html#outcomes", label: "Outcomes and ROI", external: true },
    { href: "/absenteeism/index.html#hrops", label: "HR and operations", external: true },
  ],
  agents: ["analyst", "case", "coordinator"],
  guardrails: [
    "Cohorts under the tenant threshold carry no figures and render as n<5.",
    "Risk scores are labelled modelled, never live.",
    "Agents reason only over the figures on screen and never recommend disciplinary use.",
  ],
};

export default absenceModule;
