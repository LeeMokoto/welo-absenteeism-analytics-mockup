/*
  Build the absence module's screen data from the pipeline feed.

  The feed carries everything the original dashboard needed, including per
  individual records. The portfolio screen is a cohort-level view, so it takes
  only the aggregate sections: shipping the individual records to a cohort
  screen would both bloat the bundle and contradict the module's own guardrail
  that no portfolio screen serves individual-level scores.

  Runs before the build (npm "prebuild"). Output is generated and git-ignored.
*/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedSector, tenantsToBuild } from "../lib/platform/tenants.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
  Which tenants' data this build carries (lib/platform/tenants.js).

  - A deployment that names its sector (WELO_TENANT_SECTOR) carries that
    sector alone. A sector that is named but has no data fails the build: a
    hospitality tenant quietly showing the base workforce under its own name
    is the failure this guards against.
  - A synthetic demo that does not pin a sector carries every demo tenant, so
    the tenant switch has something to switch to. A demo sector with no feed
    is left out with a warning, and the switch simply does not offer it.
  - Anything else carries the base workforce.

  Every tenant's data is written to one server module. Pages and API routes
  pick a tenant per request on the server; no client component imports this
  file, which a test checks, so a browser only ever receives one tenant.
*/
const TENANTS = tenantsToBuild(process.env);
for (const t of TENANTS) {
  if (t.sector && !/^[a-z]+$/.test(t.sector)) {
    console.error(`WELO_TENANT_SECTOR "${t.sector}" is not a sector name.`);
    process.exit(1);
  }
}
const PINNED = Boolean(pinnedSector(process.env));
const feedPath = (sector) =>
  join(ROOT, "model", "data", "outputs", sector ? `dashboard_feed.${sector}.json` : "dashboard_feed.json");
// WELO_ABSENCE_DATA_OUT redirects the output, so tests can run the build
// without rewriting the module the rest of the suite is reading.
const DEST = process.env.WELO_ABSENCE_DATA_OUT || join(ROOT, "modules", "absence", "data", "portfolio.js");
const DEST_DIR = dirname(DEST);

// Aggregate sections only. `individuals` and `intervention_queue` are per
// person and are deliberately not carried into this module's screen data.
const KEEP = [
  "run_name",
  "synthetic",
  "suppression_threshold",
  "headline",
  "risk_distribution",
  "fatigue_burnout",
  "cohort_dimensions",
  "cohorts",
  "covered_cohort",
  "hr_ops",
  // Demand set against expected absence, by department. Only a sector tenant
  // with departments has one; see model/demand.py.
  "demand",
  // What short staffing has cost and puts at risk, by month, department and
  // service. Built from shifts, with no person in it; see model/staffing_cost.py.
  "staffing_cost",
  "model_metrics",
  "data_provenance",
];

function build(feed) {
  const out = {};
  for (const k of KEEP) if (k in feed) out[k] = feed[k];
  // Defensive: never let a per-person section through, whatever the feed gains.
  for (const banned of ["individuals", "intervention_queue"]) {
    if (banned in out) delete out[banned];
  }
  return out;
}

const portfolios = {};
for (const t of TENANTS) {
  const src = feedPath(t.sector);
  if (!existsSync(src)) {
    if (PINNED) {
      console.error(`build-absence-data: no feed for sector "${t.sector}" at ${src}. Run python model/build_sector_feeds.py.`);
      process.exit(1);
    }
    console.warn(`build-absence-data: no feed for ${t.key} at ${src}; the build will not carry it.`);
    continue;
  }
  portfolios[t.key] = build(JSON.parse(readFileSync(src, "utf8")));
}

const keys = Object.keys(portfolios);
if (!keys.length) {
  console.warn("build-absence-data: no feeds found; leaving existing module data in place.");
  process.exit(0);
}
const DEFAULT_TENANT = keys.includes(TENANTS[0].key) ? TENANTS[0].key : keys[0];

mkdirSync(DEST_DIR, { recursive: true });
writeFileSync(
  DEST,
  "/*\n  GENERATED FILE. Do not edit by hand.\n" +
    "  Produced by scripts/build-absence-module-data.mjs from the pipeline feeds.\n" +
    "  Cohort-level aggregates only: no individual records. Server-side only:\n" +
    "  pages read one tenant through lib/platform/tenantContext.js.\n*/\n" +
    `export const DEFAULT_TENANT = ${JSON.stringify(DEFAULT_TENANT)};\n` +
    "export const portfolios = " +
    JSON.stringify(portfolios) +
    ";\n" +
    "// The default tenant, for tests and scripts that run outside a request.\n" +
    "export const portfolio = portfolios[DEFAULT_TENANT];\n"
);

for (const k of keys) {
  const kb = (JSON.stringify(portfolios[k]).length / 1024).toFixed(0);
  console.log(
    `build-absence-data: ${k} (${kb} KB, ${Object.keys(portfolios[k]).length} sections, no individual records).`
  );
}
console.log(`build-absence-data: wrote modules/absence/data/portfolio.js with ${keys.join(", ")}; default ${DEFAULT_TENANT}.`);
