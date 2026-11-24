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
import { ALWAYS_ON_DEFAULT, controlCentreDefault } from "./moduleDefaults";
import { canSwitch, pinnedSector, tenantByKey, tenantBySector } from "./tenants";

const env = (name, fallback = "") => (process.env[name] ?? fallback).trim();

const off = (v) => ["0", "false", "no", "off"].includes(String(v).toLowerCase());

// Suppression can be raised for a tenant but never set below five. The platform
// enforces this in the manifest schema; here we clamp, so a bad value cannot
// weaken a control by accident.
const FLOOR = 5;

/*
  The manifest for one tenant.

  Server code calls getTenantManifest() in tenantContext.js, which resolves the
  tenant from the request. Called with no argument, as tests and build scripts
  do, this is the deployment's own tenant: its pinned sector, or the base
  workforce.

  A tenant's name, descriptor and module defaults come from DEMO_TENANTS in
  tenants.js, so a sector's name and its data cannot disagree. A deployment's
  own WELO_TENANT_NAME and WELO_TENANT_DESCRIPTOR still put a prospect's name
  on the shell, but only on a deployment that does not switch: on one that
  does, a single name would sit on top of two different groups.
*/
export function getManifest({ tenant } = {}) {
  const pinned = pinnedSector(process.env);
  const switchable = canSwitch(process.env);
  const t = (tenant && tenantByKey(tenant)) || tenantBySector(pinned) || tenantByKey("base");
  const sector = pinned || t.sector || null;
  const threshold = Number(env("WELO_SUPPRESSION_THRESHOLD", String(FLOOR)));
  const synthetic = !off(env("WELO_TENANT_SYNTHETIC", "1"));
  const named = (variable, fallback) => (switchable ? fallback : env(variable, fallback));
  // A deployment's explicit module setting wins; otherwise the tenant's
  // default; otherwise on.
  const moduleOn = (variable, tenantDefault) => {
    const explicit = process.env[variable];
    if (explicit !== undefined && explicit.trim() !== "") return !off(explicit);
    if (tenantDefault !== undefined) return Boolean(tenantDefault);
    return !off(ALWAYS_ON_DEFAULT);
  };

  /*
    The control centre used to default off everywhere, which was right while it
    did not exist and wrong once it did: a deployment with no tfvars, such as
    the Vercel one, got no control centre at all unless somebody remembered an
    environment variable. The rule and the reason are in moduleDefaults.js, so
    they can be tested without rendering a page.

    WELO_MODULE_CONTROL_CENTRE still wins either way, so a client tenant whose
    real store is ready turns it on explicitly, which is a decision somebody
    makes rather than a default they inherit.
  */

  return {
    tenant: {
      // Which tenant this is, as the switch and browser storage know it.
      key: t.key,
      name: named("WELO_TENANT_NAME", t.name),
      // What kind of employer this tenant is, in the words its screens use.
      // The default matches the shipped synthetic workforce: shift-based
      // frontline operations across plants, a distribution centre and a depot.
      descriptor: named("WELO_TENANT_DESCRIPTOR", t.descriptor),
      // Which sector cohort the build carries; null for the base workforce.
      sector,
      // Whether the shell offers the tenant switch: a synthetic demo that has
      // not pinned a sector. See tenants.js.
      switchable,
      // Shown in the shell so nobody is ever unsure which tenant they are in.
      environment: env("WELO_TENANT_ENV", "demo"),
      synthetic,
    },
    suppressionThreshold: Number.isFinite(threshold)
      ? Math.max(FLOOR, threshold)
      : FLOOR,
    modules: {
      absence: moduleOn("WELO_MODULE_ABSENCE", t.modules?.absence),
      sickLeave: moduleOn("WELO_MODULE_SICK_LEAVE", t.modules?.sickLeave),
      // On for a synthetic tenant, off for a real one, overridable either way.
      // See controlCentreDefault above for why it is not simply on.
      controlCentre: !off(env("WELO_MODULE_CONTROL_CENTRE", controlCentreDefault(synthetic))),
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
