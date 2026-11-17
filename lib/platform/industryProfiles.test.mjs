import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/*
  The standalone dashboard's industry profiles (config/industry.js) supply copy
  that is written straight into the page with textContent or innerHTML. The
  ZAR / USD toggle only reaches figures carried on a data-zar attribute, so a
  Rand amount typed into a profile string would stay in Rand when a buyer flips
  to dollars, beside figures that did convert. That is the failure these tests
  hold off: every amount comes from the feed or a data-zar span, never from
  profile copy.

  The file is a browser script that assigns to window, so it is evaluated in a
  sandbox with a bare window object rather than imported.
*/

const path = fileURLToPath(new URL("../../config/industry.js", import.meta.url));
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(path, "utf8"), sandbox);
const { WELO_PROFILES: profiles, WELO_FX: fx } = sandbox.window;

// "R 1,100", "R650", "R1.2M", "$ 35", "$1.2k". Not "R&amp;D" or "Q4".
const AMOUNT = /(^|[^A-Za-z])(R|\$)\s?\d/;

function strings(value, at = []) {
  if (typeof value === "string") return [[at.join("."), value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, [...at, i]));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => strings(v, [...at, k]));
  }
  return [];
}

test("the config loads every profile, hospitality included", () => {
  for (const key of ["industrial", "mining", "generic", "manufacturing", "logistics", "hospitality"]) {
    assert.ok(profiles[key], `missing profile: ${key}`);
  }
});

test("no profile string carries a currency amount the toggle cannot convert", () => {
  const hits = Object.entries(profiles).flatMap(([key, profile]) =>
    strings(profile).filter(([, s]) => AMOUNT.test(s)).map(([p, s]) => `${key}.${p}: ${s}`),
  );
  assert.deepEqual(hits, [], `hard-coded amounts in config/industry.js:\n${hits.join("\n")}`);
});

test("ROI driver shares are fractions, so the page can price them from the feed", () => {
  for (const [key, profile] of Object.entries(profiles)) {
    const drivers = profile.benchmarks?.roi?.drivers || [];
    for (const d of drivers) {
      assert.ok(d.frac > 0 && d.frac < 1, `${key}: ${d.name} frac ${d.frac}`);
    }
    const total = drivers.reduce((sum, d) => sum + d.frac, 0);
    assert.ok(total <= 1, `${key}: ROI driver shares add to ${total}`);
  }
});

test("the dashboard's dollar rate carries the date it was taken", () => {
  assert.ok(Number(fx.zarPerUsd) > 0);
  assert.match(fx.asOf, /^\d{4}-\d{2}-\d{2}$/);
});
