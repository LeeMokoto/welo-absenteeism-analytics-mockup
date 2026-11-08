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
  /*
    Two, not three. The Case Assistant is a sick leave agent because that
    module has a case view: one record, for an occupational health clinician.
    This module's data is built from aggregates and carries no individual
    records, so there is nothing for such an agent to read.

    It was listed here, with all three mounted on nothing at all, which made
    the module contract advertise a capability the screens did not have.
  */
  agents: ["analyst", "coordinator"],
  guardrails: [
    "Cohorts under the tenant threshold carry no figures and render as n<5.",
    "Complementary suppression: where one cohort is suppressed, a second is withheld, so the first cannot be recovered by subtracting the visible rows from a published total.",
    "Risk scores are labelled modelled, never live.",
    "No cohort screen serves individual-level scores: the ported screens read module data that carries no individual records.",
    "Agents reason only over the figures on screen and never recommend disciplinary use.",
    "The agent grounding is built from the reportable cohorts only. A cohort below the suppression threshold is stripped before the payload exists and the agent is told how many were withheld, because an agent repeating a withheld figure back in prose is the easiest way for one to reach a screen.",
    "Absence frequency and Bradford scores are withheld from the agent grounding. They size a support caseload on the operations screen, where the copy says so; handed to an agent without that copy they read as a ranking of who is absent most often.",
    "This module has no Case Assistant. Its data carries no individual records, so an agent that reasons over one person is not offered rather than stubbed.",
    "Projected savings are labelled projected: no figure is reported as achieved until it is measured against a baseline.",
    "Chronic disease prevalence is a published benchmark applied to this tenant's cohort structure, never a screening result, and the panel says so in its chip, its note and its footer rather than once elsewhere. Nobody in the workforce has been screened and no figure in it came from the absence model.",
    "The chronic panel is keyed to operational load and is not re-cut by the lens selector. Re-labelling a benchmark's columns as age or tenure bands would attach a health prevalence to a group it was never measured against, and age is a protected attribute here.",
    "A cohort under the threshold is dropped from the chronic panel rather than greyed, and the drop is stated. A greyed column still puts a health prevalence beside the name of a group too small to report on.",
  ],
};

export default absenceModule;
