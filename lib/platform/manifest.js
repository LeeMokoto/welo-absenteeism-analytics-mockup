/*
  Tenant manifest.

  This is the repository-side prototype of the manifest the platform
  architecture describes: the file that declares which modules a tenant runs,
  whether its data is synthetic, and the thresholds its views enforce. In the
  platform, Terraform reads it to provision the project and the application
  reads it at start-up to switch modules on. Here it is read by the shell to
  build the navigation, so what a tenant sees follows from configuration rather
  than from hardcoded links.

  Keeping navigation manifest-driven from the start matters because it is what
  makes "one codebase, many deployments" visible in the product: a Glencore
  tenant and an Anglo American tenant differ by this file, not by a fork.
*/

const env = (name, fallback = "") => (process.env[name] ?? fallback).trim();

const off = (v) => ["0", "false", "no", "off"].includes(String(v).toLowerCase());

// Suppression can be raised for a tenant but never set below five. The platform
// enforces this in the manifest schema; here we clamp, so a bad value cannot
// weaken a control by accident.
const FLOOR = 5;

export function getManifest() {
  const threshold = Number(env("WELO_SUPPRESSION_THRESHOLD", String(FLOOR)));
  return {
    tenant: {
      name: env("WELO_TENANT_NAME", "Demo tenant"),
      // Shown in the shell so nobody is ever unsure which tenant they are in.
      environment: env("WELO_TENANT_ENV", "demo"),
      synthetic: !off(env("WELO_TENANT_SYNTHETIC", "1")),
    },
    suppressionThreshold: Number.isFinite(threshold)
      ? Math.max(FLOOR, threshold)
      : FLOOR,
    modules: {
      absence: !off(env("WELO_MODULE_ABSENCE", "1")),
      sickLeave: !off(env("WELO_MODULE_SICK_LEAVE", "1")),
      // Next phase. Off by default: a tenant turns it on only once the actions
      // store and the outbound task integration have passed their delta test.
      controlCentre: !off(env("WELO_MODULE_CONTROL_CENTRE", "0")),
    },
  };
}

// Navigation is derived from the manifest, never hardcoded. `section` groups
// the sidebar; `module` ties an entry to the manifest flag that enables it.
export function getNavigation(manifest) {
  const m = manifest.modules;
  const nav = [
    { section: "Overview", items: [{ href: "/", label: "Overview" }] },
  ];

  if (m.absence) {
    nav.push({
      section: "Absence analytics",
      items: [{ href: "/absence", label: "Portfolio and cohorts" }],
    });
  }

  if (m.sickLeave) {
    nav.push({
      section: "Sick leave",
      items: [
        { href: "/sick-leave", label: "Portfolio and cohorts" },
        { href: "/sick-leave/case", label: "Case view", clinical: true },
        { href: "/sick-leave/ops", label: "HR and operations" },
      ],
    });
  }

  if (m.controlCentre) {
    nav.push({
      section: "Control centre",
      items: [{ href: "/control-centre", label: "Interventions" }],
    });
  }

  nav.push({ section: "Administration", items: [{ href: "/admin", label: "Tenant and modules" }] });
  return nav;
}
