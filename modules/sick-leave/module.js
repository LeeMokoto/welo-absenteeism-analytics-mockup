/*
  Module definition: sick leave.

  A module declares what it is and where it lives. The shell reads this to build
  navigation, so a module is added by writing one of these and registering it,
  not by editing the shell. The manifest decides whether a tenant gets it.

  `guardrails` is here deliberately: the architecture's position is that module
  guardrails live in module code and apply in every tenant, so they belong next
  to the module rather than in a policy document that can drift from it.
*/

export const sickLeaveModule = {
  id: "sickLeave",
  label: "Sick leave",
  summary:
    "BCEA entitlement burn, condition mix at chapter level, cover planning and certification compliance.",
  // The manifest key that enables this module for a tenant.
  enabledBy: "sickLeave",
  home: "/sick-leave",
  screens: [
    { href: "/sick-leave", label: "Portfolio and cohorts" },
    { href: "/sick-leave/case", label: "Case view", clinical: true },
    { href: "/sick-leave/ops", label: "HR and operations" },
  ],
  agents: ["analyst", "case", "coordinator"],
  guardrails: [
    "No module screen serves an individual-level score outside the clinical case view.",
    "ICD-10 is held and shown at chapter level only.",
    "The Case Assistant refuses disciplinary, pattern-observation and genuineness-assessment requests.",
    "Entitlement position is planning context, never a warning about a person.",
  ],
};

export default sickLeaveModule;
