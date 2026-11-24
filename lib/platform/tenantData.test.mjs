import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
  Which workforce a build carries. WELO_TENANT_SECTOR picks a sector cohort's
  data for the absence module and the control centre's series. The failure
  these tests guard is the quiet one: a sector named but missing, and a
  hospitality tenant shipping the base workforce under its own name. The
  failing paths stop before writing anything; the successful ones below write
  to a temporary file.
*/

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const run = (script, sector) =>
  spawnSync(process.execPath, [`scripts/${script}`], {
    cwd: ROOT,
    env: { ...process.env, WELO_TENANT_SECTOR: sector },
    encoding: "utf8",
  });

for (const script of ["build-absence-module-data.mjs", "build-control-centre-data.mjs"]) {
  test(`${script}: a sector with no data fails the build`, () => {
    const r = run(script, "nosuchsector");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no (feed|series) for sector "nosuchsector"/);
  });

  test(`${script}: a malformed sector name fails before reading anything`, () => {
    const r = run(script, "../outputs");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not a sector name/);
  });
}

/*
  The successful paths. Each writes to a temporary file rather than the module
  the rest of the suite reads, because test files run in parallel.
*/
import { mkdtempSync, readFileSync as readGenerated } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
const OUT = joinPath(mkdtempSync(joinPath(tmpdir(), "welo-tenants-")), "portfolio.js");
const runEnv = (script, env) =>
  spawnSync(process.execPath, [`scripts/${script}`], {
    cwd: ROOT,
    env: {
      ...process.env,
      WELO_TENANT_SECTOR: "",
      WELO_TENANT_SYNTHETIC: "",
      WELO_TENANT_SWITCH: "",
      WELO_ABSENCE_DATA_OUT: OUT,
      ...env,
    },
    encoding: "utf8",
  });
const generated = () => readGenerated(OUT, "utf8");
const tenantsIn = (text) => Object.keys(JSON.parse(text.match(/export const portfolios = (\{.*\});\n/s)[1]));

test("a pinned build carries its sector alone", () => {
  const r = runEnv("build-absence-module-data.mjs", { WELO_TENANT_SECTOR: "hospitality" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tenantsIn(generated()), ["hospitality"]);
});

test("a real-data build carries the base workforce alone", () => {
  const r = runEnv("build-absence-module-data.mjs", { WELO_TENANT_SYNTHETIC: "0" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tenantsIn(generated()), ["base"]);
});

test("an unpinned demo build carries every demo tenant, base by default", () => {
  const r = runEnv("build-absence-module-data.mjs", {});
  assert.equal(r.status, 0, r.stderr);
  const text = generated();
  assert.deepEqual(tenantsIn(text), ["base", "hospitality"]);
  assert.match(text, /export const DEFAULT_TENANT = "base";/);
  assert.ok(!/"individuals"|"intervention_queue"/.test(text), "per-person sections in the generated data");
});
