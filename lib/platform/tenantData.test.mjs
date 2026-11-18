import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
  Which workforce a build carries. WELO_TENANT_SECTOR picks a sector cohort's
  data for the absence module and the control centre's series. The failure
  these tests guard is the quiet one: a sector named but missing, and a
  hospitality tenant shipping the base workforce under its own name. Only the
  failing paths are run here, because they stop before writing anything.
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
