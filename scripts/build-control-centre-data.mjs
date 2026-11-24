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
import { pinnedSector, tenantsToBuild } from "../lib/platform/tenants.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
  Which tenants' series this build carries: the same rule as the absence data
  (scripts/build-absence-module-data.mjs, lib/platform/tenants.js). A pinned
  sector with no series fails the build; a demo sector with none is left out.
*/
const TENANTS = tenantsToBuild(process.env);
for (const t of TENANTS) {
  if (t.sector && !/^[a-z]+$/.test(t.sector)) {
    console.error(`WELO_TENANT_SECTOR "${t.sector}" is not a sector name.`);
    process.exit(1);
  }
}
const PINNED = Boolean(pinnedSector(process.env));
const seriesPath = (sector) =>
  join(ROOT, "model", "data", "outputs", sector ? `cohort_series.${sector}.json` : "cohort_series.json");
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

function load(key, src) {
  const raw = JSON.parse(readFileSync(src, "utf8"));
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
        `build-control-centre-data: ${key}: the series carries "${banned}". A monthly series of individuals is more revealing than a snapshot of them, and it is not going into a cohort module.`,
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
          `build-control-centre-data: ${key}: ${dimKey}/${cohortKey} has no periods and is not marked suppressed. An empty series reads as no change.`,
        );
        process.exit(1);
      }
      if (hasPeriods && cohort.periods.length !== (out.periods || []).length) {
        console.error(
          `build-control-centre-data: ${key}: ${dimKey}/${cohortKey} has ${cohort.periods.length} periods, the series declares ${(out.periods || []).length}. A ragged series silently changes which months a comparison covers.`,
        );
        process.exit(1);
      }
    }
  }
  return { out, json };
}

const seriesByTenant = {};
let totalKb = 0;
for (const t of TENANTS) {
  const src = seriesPath(t.sector);
  if (!existsSync(src)) {
    if (PINNED) {
      console.error(`build-control-centre-data: no series for sector "${t.sector}" at ${src}. Run python model/build_outcome_series.py ${t.sector}.`);
      process.exit(1);
    }
    console.warn(`build-control-centre-data: no series for ${t.key} at ${src}; run model/build_outcome_series.py. The build will not carry it.`);
    continue;
  }
  const { out, json } = load(t.key, src);
  seriesByTenant[t.key] = out;
  totalKb += json.length / 1024;
}

const keys = Object.keys(seriesByTenant);
if (!keys.length) {
  console.warn("build-control-centre-data: no series found; leaving existing module data in place.");
  process.exit(0);
}
const DEFAULT_TENANT = keys.includes(TENANTS[0].key) ? TENANTS[0].key : keys[0];

mkdirSync(DEST_DIR, { recursive: true });
writeFileSync(
  DEST,
  "/*\n  GENERATED FILE. Do not edit by hand.\n" +
    "  Produced by scripts/build-control-centre-data.mjs from\n" +
    "  model/data/outputs/cohort_series*.json (model/build_outcome_series.py).\n" +
    "  Cohort aggregates per month. No individual records. Server-side only:\n" +
    "  pages read one tenant through lib/platform/tenantContext.js.\n*/\n" +
    `export const DEFAULT_TENANT = ${JSON.stringify(DEFAULT_TENANT)};\n` +
    "export const cohortSeriesByTenant = " +
    JSON.stringify(seriesByTenant) +
    ";\n" +
    "// The default tenant, for tests and scripts that run outside a request.\n" +
    "export const cohortSeries = cohortSeriesByTenant[DEFAULT_TENANT];\n",
);

console.log(
  `build-control-centre-data: wrote modules/control-centre/data/series.js with ${keys.join(", ")} (${totalKb.toFixed(0)} KB); default ${DEFAULT_TENANT}. No individual records.`,
);
