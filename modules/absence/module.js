/*
  Module definition: absence analytics.

  Ported from the original standalone dashboard. Every screen now runs in the
  shell against module data, so none is marked `external`. The standalone build
  stays reachable at /absenteeism for comparison during the cutover.

  The what-if lever panel did not come across with any of these screens: it
  operates the model forwards rather than reporting on it, and it lands in the
  workforce planning destination once the scenario endpoint is deployed.
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
    { href: "/absence/cohorts", label: "Cohorts" },
    { href: "/absence/outcomes", label: "Outcomes and ROI" },
    { href: "/absence/operations", label: "HR and operations" },
  ],
  agents: ["analyst", "case", "coordinator"],
  guardrails: [
    "Cohorts under the tenant threshold carry no figures and render as n<5.",
    "Risk scores are labelled modelled, never live.",
    "No cohort screen serves individual-level scores: the ported screens read module data that carries no individual records.",
    "Agents reason only over the figures on screen and never recommend disciplinary use.",
    "Projected savings are labelled projected: no figure is reported as achieved until it is measured against a baseline.",
  ],
};

export default absenceModule;
