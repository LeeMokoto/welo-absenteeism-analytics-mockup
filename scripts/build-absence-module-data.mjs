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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
  Which tenant's data this build carries. WELO_TENANT_SECTOR names a sector
  cohort (hospitality, say); left unset, the build carries the base workforce,
  exactly as before. A tenant is a deployment, so the choice is made here, once,
  rather than switched at runtime. A sector that is named but has no data fails
  the build: a hospitality tenant quietly showing the base workforce under its
  own name is the failure this guards against.
*/
const SECTOR = (process.env.WELO_TENANT_SECTOR || "").trim().toLowerCase();
if (SECTOR && !/^[a-z]+$/.test(SECTOR)) {
  console.error(`WELO_TENANT_SECTOR "${SECTOR}" is not a sector name.`);
  process.exit(1);
}
const SRC = join(ROOT, "model", "data", "outputs", SECTOR ? `dashboard_feed.${SECTOR}.json` : "dashboard_feed.json");
const DEST_DIR = join(ROOT, "modules", "absence", "data");
const DEST = join(DEST_DIR, "portfolio.js");

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

if (!existsSync(SRC)) {
  if (SECTOR) {
    console.error(`build-absence-data: no feed for sector "${SECTOR}" at ${SRC}. Run python model/build_sector_feeds.py.`);
    process.exit(1);
  }
  console.warn(`build-absence-data: ${SRC} not found; leaving existing module data in place.`);
  process.exit(0);
}

const feed = JSON.parse(readFileSync(SRC, "utf8"));
const out = {};
for (const k of KEEP) if (k in feed) out[k] = feed[k];

// Defensive: never let a per-person section through, whatever the feed gains.
for (const banned of ["individuals", "intervention_queue"]) {
  if (banned in out) delete out[banned];
}

mkdirSync(DEST_DIR, { recursive: true });
writeFileSync(
  DEST,
  "/*\n  GENERATED FILE. Do not edit by hand.\n" +
    "  Produced by scripts/build-absence-module-data.mjs from the pipeline feed.\n" +
    "  Cohort-level aggregates only: no individual records.\n*/\n" +
    "export const portfolio = " +
    JSON.stringify(out) +
    ";\n"
);

const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(
  `build-absence-data: wrote modules/absence/data/portfolio.js for ${SECTOR || "the base workforce"} (${kb} KB, ${Object.keys(out).length} sections, no individual records).`
);
