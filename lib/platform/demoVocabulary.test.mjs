import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/*
  The demo tenant stays sector neutral.

  This demo is distributed to prospective buyers across heavy industry:
  manufacturing, logistics, construction, facilities, mining. A demo framed as
  one of those verticals asks every other buyer to do the translating, and a
  demo carrying a named client asks them to picture a competitor. Both are easy
  to reintroduce by accident, in one line of copy, months after anyone
  remembers the decision. So it is a test rather than a convention.

  Two separate rules, for two different reasons:

  1. No named client anywhere in the demo surfaces. A prospect should never
     read another employer's name on a screen they are being sold.
  2. No vertical-locked vocabulary in the demo surfaces. "Shaft" and "stope"
     mean nothing to a distribution centre.

  Scope is the demo surfaces only. The repository legitimately contains client
  and mining specifics elsewhere, and those are listed as exemptions with the
  reason, so adding one is a visible decision rather than a silent edit.
*/

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// What ships to a prospect: the shell, the modules, and the data behind them.
const SCANNED = ["app", "components", "lib", "modules"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);
const SCAN_EXT = [".js", ".jsx", ".mjs", ".json", ".css", ".md"];

/*
  Exemptions, each with the reason it is not a demo surface.

  Nothing in app/, components/, lib/ or modules/ is exempt today. The list
  exists so that if something ever has to be, the reason is written down next
  to it.
*/
const EXEMPT = new Map([
  // path (posix, relative to repo root) -> why it may carry the vocabulary
]);

// Named clients and prospects. A demo screen names none of them.
const CLIENT_NAMES = [
  { term: "glencore", why: "a named client" },
  { term: "anglo american", why: "a named client" },
  { term: "anglo's", why: "a named client" },
];

/*
  Vertical-locked vocabulary. Each of these is a word that only one kind of
  employer uses, so it does not belong in a demo meant to fit all of them.

  Deliberately not here: "plant", "depot", "workshop", "yard", "shift",
  "roster", "crew", "backfill". Those are shared blue collar vocabulary, which
  is the point, not a problem. Also not here: "mine" on its own, because it
  collides with "determine", "mineral" and the possessive.
*/
const VERTICAL_TERMS = [
  { term: "mining", why: "mining specific" },
  { term: "mineshaft", why: "mining specific" },
  { term: "shaft", why: "mining specific" },
  { term: "stope", why: "mining specific" },
  { term: "colliery", why: "mining specific" },
  { term: "opencast", why: "mining specific" },
  { term: "underground", why: "mining specific" },
  { term: "rock drill", why: "mining specific" },
  { term: "headgear", why: "mining specific" },
];

const BANNED = [...CLIENT_NAMES, ...VERTICAL_TERMS];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

function demoFiles() {
  const files = [];
  for (const d of SCANNED) {
    const full = join(ROOT, d);
    try {
      if (statSync(full).isDirectory()) walk(full, files);
    } catch {
      // A directory that does not exist is not a failure of this test.
    }
  }
  return files
    .map((f) => relative(ROOT, f).split(sep).join("/"))
    .filter((f) => !EXEMPT.has(f))
    // This file names every banned term in order to ban them.
    .filter((f) => f !== "lib/platform/demoVocabulary.test.mjs");
}

// Guard the guard: a scan that silently matches nothing always passes.
test("the scan actually reaches the demo surfaces", () => {
  const files = demoFiles();
  assert.ok(files.length > 40, `expected to scan the app, got ${files.length} files`);
  for (const expected of [
    "app/(shell)/page.jsx",
    "lib/platform/manifest.js",
    "modules/sick-leave/dimensions.js",
    "modules/sick-leave/data/sampleData.js",
    "modules/absence/data/portfolio.js",
  ]) {
    assert.ok(files.includes(expected), `${expected} was not scanned`);
  }
});

test("no demo surface names a client", () => {
  const offences = [];
  for (const file of demoFiles()) {
    const text = readFileSync(join(ROOT, file), "utf8").toLowerCase();
    for (const { term, why } of CLIENT_NAMES) {
      if (text.includes(term)) offences.push(`${file}: "${term}" (${why})`);
    }
  }
  assert.deepEqual(offences, [], `client names in demo surfaces:\n${offences.join("\n")}`);
});

test("no demo surface uses vertical-locked vocabulary", () => {
  const offences = [];
  for (const file of demoFiles()) {
    const text = readFileSync(join(ROOT, file), "utf8").toLowerCase();
    for (const { term, why } of VERTICAL_TERMS) {
      if (text.includes(term)) offences.push(`${file}: "${term}" (${why})`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    `vertical-locked vocabulary in demo surfaces:\n${offences.join("\n")}`,
  );
});

// The deny list is only as good as its coverage, so assert it is not empty and
// that an obvious term is in it. This fails if someone empties the list to make
// a build go green.
test("the deny list covers both rules", () => {
  assert.ok(CLIENT_NAMES.length >= 2, "client deny list is too short to be doing anything");
  assert.ok(VERTICAL_TERMS.length >= 5, "vertical deny list is too short to be doing anything");
  assert.ok(BANNED.some((b) => b.term === "glencore"));
  assert.ok(BANNED.some((b) => b.term === "mining"));
  for (const { term, why } of BANNED) {
    assert.equal(term, term.toLowerCase(), `deny list terms are matched lowercased: ${term}`);
    assert.ok(why && why.length > 3, `every banned term says why: ${term}`);
  }
});
