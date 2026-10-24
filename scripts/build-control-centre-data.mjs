/*
  Build the control centre's monthly cohort series from the pipeline output.

  Source is model/data/outputs/cohort_series.json, produced by
  model/build_outcome_series.py. One row per cohort per month, aggregates only:
  the series carries no individual records and this script asserts that rather
  than trusting it, because a time series of individuals is a far more
  revealing artefact than a single snapshot of them and it would arrive here
  looking like just another section.

  Runs before the build, alongside the absence module data.
*/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "model", "data", "outputs", "cohort_series.json");
const DEST_DIR = join(ROOT, "modules", "control-centre", "data");
const DEST = join(DEST_DIR, "series.js");

const KEEP = [
  "schema_version",
  "periods",
  "period_grain",
  "measure",
  "measure_source",
  "membership",
  "suppression_threshold",
  "synthetic",
  "simulation",
  "series",
];

if (!existsSync(SRC)) {
  console.warn(
    `build-control-centre-data: ${SRC} not found; run model/build_outcome_series.py. Leaving existing module data in place.`,
  );
  process.exit(0);
}

const raw = JSON.parse(readFileSync(SRC, "utf8"));
const out = {};
for (const k of KEEP) if (k in raw) out[k] = raw[k];

// A series of individuals is the thing this must never carry. Checked against
// the whole payload, not just the top level, so a per-person array nested
// inside a cohort fails here rather than shipping.
const BANNED = ["individuals", "employee_id", "employee_key", "intervention_queue", "rows"];
const json = JSON.stringify(out);
for (const banned of BANNED) {
  if (json.includes(`"${banned}"`)) {
    console.error(
      `build-control-centre-data: the series carries "${banned}". A monthly series of individuals is more revealing than a snapshot of them, and it is not going into a cohort module.`,
    );
    process.exit(1);
  }
}

// Every cohort either carries periods or is marked suppressed. A cohort with
// neither is a hole that reads as "no change" on a screen.
for (const [dimKey, dim] of Object.entries(out.series || {})) {
  for (const [cohortKey, cohort] of Object.entries(dim.cohorts || {})) {
    const hasPeriods = Array.isArray(cohort.periods) && cohort.periods.length > 0;
    if (!hasPeriods && !cohort.suppressed) {
      console.error(
        `build-control-centre-data: ${dimKey}/${cohortKey} has no periods and is not marked suppressed. An empty series reads as no change.`,
      );
      process.exit(1);
    }
    if (hasPeriods && cohort.periods.length !== (out.periods || []).length) {
      console.error(
        `build-control-centre-data: ${dimKey}/${cohortKey} has ${cohort.periods.length} periods, the series declares ${(out.periods || []).length}. A ragged series silently changes which months a comparison covers.`,
      );
      process.exit(1);
    }
  }
}

mkdirSync(DEST_DIR, { recursive: true });
writeFileSync(
  DEST,
  "/*\n  GENERATED FILE. Do not edit by hand.\n" +
    "  Produced by scripts/build-control-centre-data.mjs from\n" +
    "  model/data/outputs/cohort_series.json (model/build_outcome_series.py).\n" +
    "  Cohort aggregates per month. No individual records.\n*/\n" +
    "export const cohortSeries = " +
    JSON.stringify(out) +
    ";\n",
);

const kb = (json.length / 1024).toFixed(0);
const dims = Object.keys(out.series || {}).length;
console.log(
  `build-control-centre-data: wrote modules/control-centre/data/series.js (${kb} KB, ${(out.periods || []).length} monthly periods, ${dims} dimensions, no individual records).`,
);
