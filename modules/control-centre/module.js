/*
  Module definition: control centre.

  Next phase in the solution design, and built in the demo tenant first. It
  stays off for every tenant by default and is enabled only once the actions
  store and the outbound task integration have passed their delta test, which
  is why the manifest flag defaults to false and the route 404s without it.

  What is built here runs against a mocked actions store, because this tenant
  has no VPC to put a private database inside. The shape of the records is not
  mocked: every one refers to a cohort and carries no employee key.
*/

export const controlCentreModule = {
  id: "control-centre",
  label: "Control centre",
  summary:
    "Act on cohorts and measure whether it worked. Interventions, playbooks, alert rules and outcomes, all at cohort level, with targeting held to stricter rules than reporting and measurement held to comparators frozen in advance.",
  enabledBy: "controlCentre",
  home: "/control-centre",
  screens: [
    { href: "/control-centre", label: "Interventions" },
    { href: "/control-centre/playbooks", label: "Playbooks" },
    { href: "/control-centre/alerts", label: "Alert rules" },
  ],
  agents: ["playbook"],
  guardrails: [
    "Every record refers to a cohort. No record carries an employee key, and the store strips individual fields rather than trusting its callers.",
    "Targeting is stricter than reporting: at most two dimensions, never a protected attribute, never condition data.",
    "Age is a reporting dimension and is not a targeting dimension. Reporting on a protected attribute is a client decision with a raised minimum cohort size; targeting on one is not available at any threshold.",
    "An intervention cannot name a cohort that is suppressed, or one below the tenant threshold.",
    "Outcomes are reported as an observed difference against comparable cohorts, never as proof that an intervention caused it, and no single percentage improvement is published: the targeted change, the comparator change and the difference are all shown so the reader does the comparison.",
    "Comparators freeze when an intervention is created, from the other reportable cohorts of its dimension. There is no fallback to a live list: an intervention with none is reported as unmeasurable rather than compared against cohorts chosen once the answer is known.",
    "Cohort membership freezes at the baseline period, so a measurement is of a before and an after rather than of two different groups of people.",
    "Outcomes are measured from actual absence, never from the model that selected the cohort. Measuring an intervention with its own targeting model would report a success whenever the model revised its view.",
    "A cohort under the threshold is withheld for every period of its series, because one visible period beside a withheld one leaks the withheld count through the difference.",
    "Alert rules are scoped with the same rules as an intervention target, and no alert names a cohort under the threshold: a rule across a dimension skips what it cannot report on and says how many.",
    "Rules watch rates and averages, never counts. A rule on a count fires because a cohort is large rather than because it is unwell.",
    "The actions store is mocked in this tenant and the interface says so, rather than letting a walkthrough imply a durable record was filed.",
    "A playbook carries no target of its own: it inherits the intervention's, so a plan cannot reach a wider group than the record it hangs off.",
    "No playbook step names a person, and no step may be a disciplinary action, an attendance-management action, surveillance of a person, or an employment consequence attached to a health measure. A draft that contains one is refused with the step named.",
    "Every playbook step that counts names a measure the platform actually reports, so a plan can be closed out against something rather than declared a success.",
    "The agent drafts and a person decides. The approver is never the drafter, checked by identity and not only by role, because POPIA section 71 restricts decisions based solely on automated processing.",
  ],
};

export default controlCentreModule;
