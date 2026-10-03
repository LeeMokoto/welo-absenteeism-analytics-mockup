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
const SRC = join(ROOT, "model", "data", "outputs", "dashboard_feed.json");
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
  "model_metrics",
  "data_provenance",
];

if (!existsSync(SRC)) {
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
  `build-absence-data: wrote modules/absence/data/portfolio.js (${kb} KB, ${Object.keys(out).length} sections, no individual records).`
);
