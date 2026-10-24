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
  makes "one codebase, many deployments" visible in the product: two client
  tenants differ by this file, not by a fork.

  The tenant name and descriptor are configuration for the same reason, and
  that is useful before a demo as well as in production. The tenant that ships
  is a sector-neutral industrial employer, which is what the synthetic data is
  calibrated to; setting WELO_TENANT_NAME and WELO_TENANT_DESCRIPTOR puts a
  prospect's own name and words on the shell without touching the code.
*/

import { enabledModules } from "@/modules/registry";

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
      name: env("WELO_TENANT_NAME", "Demo Industrial Group"),
      // What kind of employer this tenant is, in the words its screens use.
      // The default matches the shipped synthetic workforce: shift-based
      // frontline operations across plants, a distribution centre and a depot.
      descriptor: env("WELO_TENANT_DESCRIPTOR", "A multi-site industrial operation"),
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

// Navigation is composed from the module registry, never hardcoded here. Each
// module declares its own screens; this only decides which modules a tenant has
// and what order they appear in.
export function getNavigation(manifest) {
  const nav = [
    { section: "Overview", items: [{ href: "/", label: "Overview" }] },
  ];

  for (const mod of enabledModules(manifest)) {
    nav.push({ section: mod.label, items: mod.screens });
  }

  nav.push({ section: "Administration", items: [{ href: "/admin", label: "Tenant and modules" }] });
  return nav;
}
