import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE_TENANT,
  DEMO_TENANTS,
  canSwitch,
  pinnedSector,
  resolveTenant,
  scopedStorageKey,
  tenantOptions,
  tenantsToBuild,
} from "./tenants.js";

/*
  The tenant switch, and the one rule it must never bend: a real client
  deployment is one tenant. Only a synthetic demo that has not pinned a
  sector offers the switch, and no browser ever receives two tenants' data.
*/

const BOTH = DEMO_TENANTS.map((t) => t.key);

test("an unpinned synthetic demo offers the switch", () => {
  assert.equal(canSwitch({}), true);
  assert.equal(canSwitch({ WELO_TENANT_SYNTHETIC: "1" }), true);
});

test("a deployment pinned to a sector does not switch", () => {
  assert.equal(pinnedSector({ WELO_TENANT_SECTOR: " Hospitality " }), "hospitality");
  assert.equal(canSwitch({ WELO_TENANT_SECTOR: "hospitality" }), false);
});

test("a deployment holding real data never switches", () => {
  for (const v of ["0", "false", "off", "no"]) {
    assert.equal(canSwitch({ WELO_TENANT_SYNTHETIC: v }), false, v);
  }
});

test("a demo can turn the switch off", () => {
  assert.equal(canSwitch({ WELO_TENANT_SWITCH: "0" }), false);
});

test("the cookie chooses the tenant on a demo", () => {
  assert.equal(resolveTenant({ env: {}, cookie: "hospitality", available: BOTH }), "hospitality");
  assert.equal(resolveTenant({ env: {}, cookie: BASE_TENANT, available: BOTH }), BASE_TENANT);
});

test("with no cookie, the demo shows its default", () => {
  assert.equal(resolveTenant({ env: {}, available: BOTH }), BASE_TENANT);
});

test("a pinned deployment ignores the cookie", () => {
  const env = { WELO_TENANT_SECTOR: "hospitality" };
  assert.equal(resolveTenant({ env, cookie: BASE_TENANT, available: ["hospitality"], fallback: "hospitality" }), "hospitality");
});

test("a real-data deployment ignores the cookie", () => {
  const env = { WELO_TENANT_SYNTHETIC: "0" };
  assert.equal(resolveTenant({ env, cookie: "hospitality", available: [BASE_TENANT] }), BASE_TENANT);
});

test("a cookie naming a tenant the build does not carry falls back", () => {
  assert.equal(resolveTenant({ env: {}, cookie: "hospitality", available: [BASE_TENANT] }), BASE_TENANT);
  assert.equal(resolveTenant({ env: {}, cookie: "nosuch", available: BOTH }), BASE_TENANT);
  assert.equal(resolveTenant({ env: {}, cookie: "../../etc", available: BOTH }), BASE_TENANT);
});

test("a data build carries every demo tenant only when it can switch", () => {
  assert.deepEqual(tenantsToBuild({}).map((t) => t.key), BOTH);
  assert.deepEqual(tenantsToBuild({ WELO_TENANT_SECTOR: "hospitality" }), [{ key: "hospitality", sector: "hospitality" }]);
  assert.deepEqual(tenantsToBuild({ WELO_TENANT_SYNTHETIC: "0" }), [{ key: BASE_TENANT, sector: null }]);
});

test("the switch offers only tenants the build carries", () => {
  assert.deepEqual(tenantOptions([BASE_TENANT]).map((t) => t.key), [BASE_TENANT]);
  assert.deepEqual(tenantOptions(BOTH).map((t) => t.key), BOTH);
  for (const t of tenantOptions(BOTH)) assert.ok(t.name && t.short);
});

test("browser storage is per tenant, and the base tenant keeps its old keys", () => {
  const key = "welo.control-centre.interventions.v1";
  assert.equal(scopedStorageKey(key, BASE_TENANT), key);
  assert.equal(scopedStorageKey(key, null), key);
  assert.notEqual(scopedStorageKey(key, "hospitality"), key);
  assert.notEqual(scopedStorageKey(key, "hospitality"), scopedStorageKey(key, BASE_TENANT));
});

test("every demo tenant has a name and a short label for the switch", () => {
  const keys = new Set();
  for (const t of DEMO_TENANTS) {
    assert.ok(t.key && t.name && t.short && t.descriptor, t.key);
    assert.ok(!keys.has(t.key), `duplicate tenant ${t.key}`);
    keys.add(t.key);
  }
});

/*
  The generated data modules hold every tenant a demo build carries. A client
  component that imported one would ship every tenant's figures to the
  browser. Only server code may import them, through tenantContext.js, which
  must itself stay out of client code.
*/
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx|mjs)$/.test(name) && !name.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}

test("no client component imports tenant data or the tenant context", () => {
  const offences = [];
  for (const dir of ["app", "components", "modules", "lib"]) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/.test(text)) continue;
      if (/data\/portfolio|data\/series|tenantContext/.test(text)) {
        offences.push(relative(ROOT, file).split(sep).join("/"));
      }
    }
  }
  assert.deepEqual(offences, [], `client components importing tenant data:\n${offences.join("\n")}`);
});

test("pages and routes read tenant data through the tenant context only", () => {
  const offences = [];
  for (const file of sourceFiles(join(ROOT, "app"))) {
    const text = readFileSync(file, "utf8");
    if (/from\s+["'][^"']*(absence\/data\/portfolio|control-centre\/data\/series)["']/.test(text)) {
      offences.push(relative(ROOT, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(offences, [], `direct imports of tenant data:\n${offences.join("\n")}`);
});
