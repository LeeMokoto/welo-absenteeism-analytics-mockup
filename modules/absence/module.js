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
    "Complementary suppression: where one cohort is suppressed, a second is withheld, so the first cannot be recovered by subtracting the visible rows from a published total.",
    "Risk scores are labelled modelled, never live.",
    "No cohort screen serves individual-level scores: the ported screens read module data that carries no individual records.",
    "Agents reason only over the figures on screen and never recommend disciplinary use.",
    "Projected savings are labelled projected: no figure is reported as achieved until it is measured against a baseline.",
    "Chronic disease prevalence is a published benchmark applied to this tenant's cohort structure, never a screening result, and the panel says so in its chip, its note and its footer rather than once elsewhere. Nobody in the workforce has been screened and no figure in it came from the absence model.",
    "The chronic panel is keyed to operational load and is not re-cut by the lens selector. Re-labelling a benchmark's columns as age or tenure bands would attach a health prevalence to a group it was never measured against, and age is a protected attribute here.",
    "A cohort under the threshold is dropped from the chronic panel rather than greyed, and the drop is stated. A greyed column still puts a health prevalence beside the name of a group too small to report on.",
  ],
};

export default absenceModule;
