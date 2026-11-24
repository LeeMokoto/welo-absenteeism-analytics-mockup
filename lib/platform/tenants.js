/*
  Which tenant a request is for.

  A real client deployment is one tenant, and nothing here changes that: when
  the deployment names its sector (WELO_TENANT_SECTOR), or holds real data
  (WELO_TENANT_SYNTHETIC=0), the tenant is fixed and no switch is offered.

  A synthetic demo is different. It exists to show the product, and showing
  the same product for an industrial group and a hospitality group, one after
  the other in the same meeting, is the point. So an unpinned synthetic demo
  carries every demo tenant's data and lets the visitor choose, by a cookie,
  much as the currency toggle lets them choose Rand or dollars. Every page and
  API route resolves the tenant from that cookie on the server; nothing on the
  client ever holds two tenants' figures at once.

  These rules are pure so they can be tested without a request. The server
  side that reads the cookie is tenantContext.js.
*/

export const TENANT_COOKIE = "welo_demo_tenant";

// The base workforce, the tenant a demo shows when nothing is chosen.
export const BASE_TENANT = "base";

/*
  The demo tenants, in the order the switch offers them. `sector` names the
  cohort the data scripts read (null for the base workforce); `modules` holds
  module defaults that differ by tenant. A deployment's own WELO_MODULE_*
  variables still win over these.
*/
export const DEMO_TENANTS = [
  {
    key: BASE_TENANT,
    sector: null,
    name: "Demo Industrial Group",
    short: "Industrial",
    descriptor: "A multi-site industrial operation",
    modules: {},
  },
  {
    key: "hospitality",
    sector: "hospitality",
    name: "Demo Hospitality Group",
    short: "Hospitality",
    descriptor: "Hotels, restaurants and contract catering",
    // Sick leave is the occupational health module built for heavy industry;
    // a hospitality tenant does not carry it.
    modules: { sickLeave: false },
  },
];

export function tenantByKey(key) {
  return DEMO_TENANTS.find((t) => t.key === key) || null;
}

export function tenantBySector(sector) {
  if (!sector) return tenantByKey(BASE_TENANT);
  return DEMO_TENANTS.find((t) => t.sector === sector) || null;
}

const off = (v) => ["0", "false", "off", "no"].includes(String(v ?? "").trim().toLowerCase());

/* The sector a deployment pins itself to, or null. */
export function pinnedSector(env = {}) {
  const s = String(env.WELO_TENANT_SECTOR || "").trim().toLowerCase();
  return s || null;
}

/*
  Whether this deployment offers the switch. Only a synthetic demo that has
  not pinned a sector, and has not turned the switch off (WELO_TENANT_SWITCH=0).
*/
export function canSwitch(env = {}) {
  if (pinnedSector(env)) return false;
  if (off(env.WELO_TENANT_SYNTHETIC ?? "1")) return false;
  if (off(env.WELO_TENANT_SWITCH ?? "1")) return false;
  return true;
}

/*
  The tenant key for a request.

  - Pinned: the pinned sector's key, whatever the cookie says.
  - Switchable: the cookie, if it names a tenant this build carries data for.
  - Otherwise: the build's default.

  `available` is the tenant keys the build carries data for; a cookie naming
  one it does not carry falls back rather than showing an empty tenant.
*/
export function resolveTenant({ env = {}, cookie, available = [BASE_TENANT], fallback = BASE_TENANT } = {}) {
  const pinned = pinnedSector(env);
  if (pinned) return tenantBySector(pinned)?.key || pinned;
  if (canSwitch(env) && cookie && available.includes(cookie) && tenantByKey(cookie)) return cookie;
  return available.includes(fallback) ? fallback : available[0];
}

/* The choices the switch shows: demo tenants this build has data for. */
export function tenantOptions(available = []) {
  return DEMO_TENANTS.filter((t) => available.includes(t.key)).map(({ key, name, short }) => ({ key, name, short }));
}

/*
  Which tenants a data build carries. Pinned: that sector alone. Otherwise the
  base workforce plus every demo sector, so the switch has something to show.
*/
export function tenantsToBuild(env = {}) {
  const pinned = pinnedSector(env);
  if (pinned) return [{ key: tenantBySector(pinned)?.key || pinned, sector: pinned }];
  if (!canSwitch(env)) return [{ key: BASE_TENANT, sector: null }];
  return DEMO_TENANTS.map(({ key, sector }) => ({ key, sector }));
}

/*
  A browser storage key for the current tenant. The base tenant keeps the key
  it always had, so nothing already saved in a browser is lost; every other
  tenant gets its own, so an intervention drafted for one group never appears
  in another's list.
*/
export function scopedStorageKey(key, tenant) {
  return !tenant || tenant === BASE_TENANT ? key : `${key}.${tenant}`;
}
