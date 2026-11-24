import { cookies } from "next/headers";
import { DEFAULT_TENANT, portfolios } from "@/modules/absence/data/portfolio";
import { cohortSeriesByTenant } from "@/modules/control-centre/data/series";
import { getManifest } from "./manifest";
import { TENANT_COOKIE, resolveTenant, tenantOptions } from "./tenants";

/*
  The tenant for this request, and its data.

  Every page and API route reads tenant data through here rather than
  importing the generated modules, so one rule decides which tenant a request
  sees (resolveTenant in tenants.js) and nobody can pick up the default
  tenant's figures by accident while the shell says another tenant's name.

  Server-only: the generated modules hold every tenant the build carries, and
  a client component must never import them. Screens that run in the browser
  get their one tenant's data as props.
*/

export async function currentTenant() {
  const store = await cookies();
  return resolveTenant({
    env: process.env,
    cookie: store.get(TENANT_COOKIE)?.value,
    available: Object.keys(portfolios),
    fallback: DEFAULT_TENANT,
  });
}

export async function getTenantManifest() {
  return getManifest({ tenant: await currentTenant() });
}

export async function getPortfolio() {
  return portfolios[await currentTenant()] || portfolios[DEFAULT_TENANT];
}

export async function getCohortSeries() {
  const key = await currentTenant();
  return cohortSeriesByTenant[key] || null;
}

/* What the switch offers: the tenants this build carries data for. */
export function availableTenants() {
  return tenantOptions(Object.keys(portfolios));
}
