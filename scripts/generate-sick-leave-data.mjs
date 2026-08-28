/*
  Deterministic synthetic data generator for the Sick Leave Intelligence
  dashboard. Run with: npm run generate-data

  Governance rules baked into this generator (see the build brief, section 1 and
  section 9):
  - No employee names. Pseudonymous ids only, format EMP-#####.
  - NO individual-level pattern features. There is deliberately no day-of-week
    adjacency, no post-payday clustering, no spell-frequency "suspicion" score,
    and no credibility indicator anywhere in the record or the aggregates. Those
    features are trivial to add and are exactly the ones that end up in a CCMA
    hearing, so they are out by design.
  - ICD-10 is stored at CHAPTER level only, never a specific code.
  - Every Rand input is indicative and lives in lib/sick-leave/costModel.js.

  Output is written to lib/sick-leave/sampleData.js (employees + aggregates) and
  lib/sick-leave/sampleData.events.js (per-employee spell history for the
  clinical case view). Both are checked in. Nothing is fetched at runtime.
*/

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COST_MODEL, coverDayCostRand } from "../lib/sick-leave/costModel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "lib", "sick-leave");

// ---- Deterministic RNG (mulberry32) ----------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260828);
const rnd = () => rng();
const randint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function weighted(pairs) {
  // pairs: [[value, weight], ...]
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
function gauss(mean, sd) {
  const u = 1 - rnd();
  const v = rnd();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- Reference dimensions ---------------------------------------------------
const TODAY = new Date("2026-08-28T00:00:00Z");
const CYCLE_MONTHS = 36;
const STANDARD_ENTITLEMENT = 30; // BCEA: 30 days per 36-month cycle, 5-day week

const SITES = ["North Shaft", "South Shaft", "Central Plant", "Logistics Hub"];
const FUNCTIONS = [
  "Mining Operations",
  "Processing",
  "Engineering and Maintenance",
  "Logistics",
  "Administration",
];
const SHIFTS = [
  "Continuous (4 on 4 off)",
  "Day shift",
  "Rotating three-shift",
  "Standard business hours",
];
const AGE_BANDS = ["18-29", "30-39", "40-49", "50-59", "60+"];

// Scheduled working days per 12 months by shift pattern (indicative denominator
// for the sick leave rate).
const SCHEDULED_DAYS_PER_YEAR = {
  "Continuous (4 on 4 off)": 182,
  "Day shift": 232,
  "Rotating three-shift": 219,
  "Standard business hours": 232,
};

const ICD_CHAPTERS = [
  "Respiratory (J)",
  "Musculoskeletal (M)",
  "Digestive (K)",
  "Infectious and parasitic (A and B)",
  "Injury and external causes (S and T)",
  "Mental and behavioural (F)",
  "Circulatory (I)",
  "Endocrine and metabolic (E)",
  "Symptoms and ill-defined (R)",
  "Not recorded",
];

const PRACTITIONERS = [
  "Medical practitioner",
  "On-site clinic",
  "Traditional health practitioner",
  "Not recorded",
];

const DRIVERS = [
  "Chronic condition management",
  "Musculoskeletal strain",
  "Respiratory recurrence",
  "Fatigue and shift load",
  "Mental health",
  "Commute and travel burden",
  "Certification gap",
  "Post-injury recovery",
];

const DRIVER_DERIVATION = {
  "Chronic condition management":
    "Derived from repeated cohort-level chapter coding consistent with an ongoing condition and entitlement burn.",
  "Musculoskeletal strain":
    "Derived from the share of days coded to the musculoskeletal chapter for this function and site.",
  "Respiratory recurrence":
    "Derived from the share of spells coded to the respiratory chapter across the cycle.",
  "Fatigue and shift load":
    "Derived from the shift pattern and cohort sick leave rate, not from any individual timing analysis.",
  "Mental health":
    "Derived from the presence of the mental and behavioural chapter at cohort level, treated as a care signal.",
  "Commute and travel burden":
    "Derived from site and function logistics exposure, a cohort attribute.",
  "Certification gap":
    "Derived from the share of qualifying spells without a certificate on file, a records quality measure.",
  "Post-injury recovery":
    "Derived from the presence of an injury chapter spell and an open return-to-work state.",
};

// Base ICD chapter weights, then a per-function modifier (mining skews to
// musculoskeletal, injury and respiratory).
const CHAPTER_BASE = {
  "Respiratory (J)": 20,
  "Musculoskeletal (M)": 22,
  "Digestive (K)": 8,
  "Infectious and parasitic (A and B)": 12,
  "Injury and external causes (S and T)": 14,
  "Mental and behavioural (F)": 9,
  "Circulatory (I)": 5,
  "Endocrine and metabolic (E)": 4,
  "Symptoms and ill-defined (R)": 4,
  "Not recorded": 6,
};
const FUNCTION_CHAPTER_MOD = {
  "Mining Operations": { "Musculoskeletal (M)": 1.5, "Injury and external causes (S and T)": 1.7, "Respiratory (J)": 1.2 },
  Processing: { "Respiratory (J)": 1.6, "Musculoskeletal (M)": 1.2 },
  "Engineering and Maintenance": { "Injury and external causes (S and T)": 1.4, "Musculoskeletal (M)": 1.3 },
  Logistics: { "Musculoskeletal (M)": 1.3, "Circulatory (I)": 1.2 },
  Administration: { "Mental and behavioural (F)": 1.4, "Musculoskeletal (M)": 0.6, "Injury and external causes (S and T)": 0.4 },
};

// ---- Date helpers -----------------------------------------------------------
function addMonths(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
function monthsBetween(a, b) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

// ---- Employee + event generation -------------------------------------------
function chapterFor(fn) {
  const mod = FUNCTION_CHAPTER_MOD[fn] || {};
  const pairs = ICD_CHAPTERS.map((c) => [c, CHAPTER_BASE[c] * (mod[c] || 1)]);
  return weighted(pairs);
}

function practitionerFor() {
  return weighted([
    ["Medical practitioner", 55],
    ["On-site clinic", 26],
    ["Traditional health practitioner", 9],
    ["Not recorded", 10],
  ]);
}

function spellDaysFor(chapter) {
  // Longer spells for musculoskeletal, mental health and injury; shorter for
  // respiratory and infectious.
  let mean = 2.2;
  let sd = 1.6;
  if (chapter === "Musculoskeletal (M)") { mean = 4.5; sd = 3.5; }
  else if (chapter === "Mental and behavioural (F)") { mean = 6.0; sd = 4.5; }
  else if (chapter === "Injury and external causes (S and T)") { mean = 7.5; sd = 6.0; }
  else if (chapter === "Circulatory (I)") { mean = 4.0; sd = 3.0; }
  else if (chapter === "Respiratory (J)") { mean = 2.4; sd = 1.5; }
  const d = Math.max(1, Math.round(gauss(mean, sd)));
  return Math.min(d, 30);
}

function buildEmployee(i) {
  const employeeId = "EMP-" + String(10000 + i).padStart(5, "0");
  const site = weighted([
    ["North Shaft", 30],
    ["South Shaft", 28],
    ["Central Plant", 26],
    ["Logistics Hub", 16],
  ]);
  // Function mix depends a little on the site.
  const fnPairs =
    site === "Logistics Hub"
      ? [["Logistics", 45], ["Engineering and Maintenance", 18], ["Administration", 20], ["Processing", 9], ["Mining Operations", 8]]
      : site === "Central Plant"
      ? [["Processing", 42], ["Engineering and Maintenance", 26], ["Mining Operations", 10], ["Logistics", 10], ["Administration", 12]]
      : [["Mining Operations", 46], ["Engineering and Maintenance", 22], ["Processing", 12], ["Logistics", 8], ["Administration", 12]];
  const fn = weighted(fnPairs);

  // Shift pattern depends on function.
  const shift =
    fn === "Administration"
      ? "Standard business hours"
      : fn === "Mining Operations"
      ? weighted([["Continuous (4 on 4 off)", 55], ["Rotating three-shift", 40], ["Day shift", 5]])
      : fn === "Processing"
      ? weighted([["Rotating three-shift", 60], ["Continuous (4 on 4 off)", 30], ["Day shift", 10]])
      : fn === "Logistics"
      ? weighted([["Day shift", 55], ["Rotating three-shift", 30], ["Continuous (4 on 4 off)", 15]])
      : weighted([["Day shift", 60], ["Rotating three-shift", 25], ["Continuous (4 on 4 off)", 15]]);

  const tenureMonths = randint(1, 340);
  const ageBand = weighted([
    ["18-29", 18],
    ["30-39", 30],
    ["40-49", 27],
    ["50-59", 18],
    ["60+", 7],
  ]);

  // Current 36-month BCEA cycle.
  const monthsElapsed = Math.min(tenureMonths, randint(1, CYCLE_MONTHS - 1));
  const cycleStart = addMonths(TODAY, -monthsElapsed);

  // Entitlement: 30 days for a standard 5-day week, prorated in first 6 months.
  let entitlementDays = STANDARD_ENTITLEMENT;
  if (tenureMonths < 6) {
    const workingDays = Math.round(tenureMonths * 21.7);
    entitlementDays = Math.max(1, Math.min(STANDARD_ENTITLEMENT, Math.floor(workingDays / 26)));
  }

  // Spell propensity: cohort-shaped, no individual timing signal.
  let lambda = 0.9 + monthsElapsed * 0.06;
  if (shift === "Continuous (4 on 4 off)" || shift === "Rotating three-shift") lambda *= 1.25;
  if (fn === "Mining Operations" || fn === "Processing") lambda *= 1.15;
  if (ageBand === "50-59") lambda *= 1.1;
  if (ageBand === "60+") lambda *= 1.2;
  const spellCount = Math.max(0, Math.round(gauss(lambda, Math.sqrt(lambda))));

  // Generate spells spread uniformly across the cycle window. Uniform spread,
  // deliberately, so no clustering pattern can be read from an individual.
  const windowDays = Math.max(1, Math.round((TODAY - cycleStart) / 86400000));
  const spells = [];
  for (let s = 0; s < spellCount; s++) {
    const chapter = chapterFor(fn);
    const days = spellDaysFor(chapter);
    const startOffset = randint(0, Math.max(0, windowDays - 1));
    const startDate = addDays(cycleStart, startOffset);
    const endDate = addDays(startDate, days - 1);
    const practitionerType = practitionerFor();
    // Certification: a qualifying (more than 2 day) spell is usually certified;
    // "Not recorded" practitioner means no certificate on file.
    let certified;
    if (practitionerType === "Not recorded") certified = false;
    else if (days > 2) certified = rnd() < 0.9;
    else certified = rnd() < 0.6;
    spells.push({ chapter, days, startDate, endDate, practitionerType, certified });
  }
  spells.sort((a, b) => a.startDate - b.startDate);

  // Paid vs unpaid against entitlement, in date order.
  let paidConsumed = 0;
  const events = spells.map((sp, idx) => {
    let paid;
    if (paidConsumed >= entitlementDays) paid = false;
    else {
      paid = true;
      paidConsumed = Math.min(entitlementDays, paidConsumed + sp.days);
    }
    return {
      eventId: `${employeeId}-E${String(idx + 1).padStart(2, "0")}`,
      employeeId,
      startDate: isoDate(sp.startDate),
      endDate: isoDate(sp.endDate),
      days: sp.days,
      paid,
      certified: sp.certified,
      practitionerType: sp.practitionerType,
      icd10Chapter: sp.chapter,
    };
  });

  const daysConsumed = Number(paidConsumed.toFixed(1));
  const daysRemaining = Number(Math.max(0, entitlementDays - daysConsumed).toFixed(1));

  // Projected exhaustion: linear on current burn rate. Null if none remaining
  // or no burn.
  let projectedExhaustionDate = null;
  const burnPerMonth = daysConsumed / Math.max(1, monthsElapsed);
  if (daysRemaining > 0 && burnPerMonth > 0.01) {
    const monthsToGo = daysRemaining / burnPerMonth;
    projectedExhaustionDate = isoDate(addMonths(TODAY, Math.round(monthsToGo)));
  }

  // Drivers: derived from cohort attributes and chapter mix. No timing features.
  const chapterCounts = {};
  for (const e of events) chapterCounts[e.icd10Chapter] = (chapterCounts[e.icd10Chapter] || 0) + 1;
  const drivers = deriveDrivers({ fn, shift, events, chapterCounts, daysConsumed, entitlementDays });

  // Modelled risk (0..1). Built from entitlement burn, driver load, shift load,
  // age and tenure. Explicitly NOT from any pattern feature.
  const burnFrac = daysConsumed / entitlementDays;
  let risk =
    0.35 * Math.min(1, burnFrac) +
    0.22 * Math.min(1, drivers.length / 4) +
    0.14 * (shift === "Continuous (4 on 4 off)" || shift === "Rotating three-shift" ? 1 : 0.3) +
    0.1 * (ageBand === "50-59" ? 0.7 : ageBand === "60+" ? 1 : 0.3) +
    0.09 * (tenureMonths < 12 ? 0.8 : 0.3) +
    0.1 * Math.min(1, events.length / 6);
  risk = Math.max(0, Math.min(1, risk + gauss(0, 0.05)));
  const riskScore = Number(risk.toFixed(3));
  const riskTier = risk < 0.34 ? "Low" : risk < 0.64 ? "Moderate" : "Elevated";

  // Return-to-work open state: a recent longer spell still in recovery.
  let rtwOpen = false;
  if (events.length) {
    const last = events[events.length - 1];
    const endedDaysAgo = Math.round((TODAY - new Date(last.endDate)) / 86400000);
    if (last.days >= 5 && endedDaysAgo >= -2 && endedDaysAgo <= 21) rtwOpen = true;
  }

  return {
    record: {
      employeeId,
      site,
      function: fn,
      shiftPattern: shift,
      tenureMonths,
      ageBand,
      cycleStartDate: isoDate(cycleStart),
      entitlementDays,
      daysConsumed,
      daysRemaining,
      projectedExhaustionDate,
      riskScore,
      riskTier,
      drivers,
      rtwOpen,
      // Convenience counts for selectors and aggregates (not pattern features).
      spellCount: events.length,
      sickDaysCycle: Number(events.reduce((s, e) => s + e.days, 0).toFixed(1)),
      monthsElapsed,
    },
    events,
  };
}

function deriveDrivers({ fn, shift, events, chapterCounts, daysConsumed, entitlementDays }) {
  const scored = [];
  const total = events.length || 1;
  const share = (c) => (chapterCounts[c] || 0) / total;

  scored.push(["Musculoskeletal strain", share("Musculoskeletal (M)") * 1.2]);
  scored.push(["Respiratory recurrence", share("Respiratory (J)") * 1.0]);
  scored.push(["Mental health", share("Mental and behavioural (F)") * 1.3]);
  scored.push([
    "Post-injury recovery",
    share("Injury and external causes (S and T)") * 1.2,
  ]);
  scored.push([
    "Fatigue and shift load",
    (shift === "Continuous (4 on 4 off)" || shift === "Rotating three-shift" ? 0.35 : 0.08),
  ]);
  scored.push(["Commute and travel burden", fn === "Logistics" ? 0.3 : 0.05]);
  scored.push([
    "Chronic condition management",
    daysConsumed / entitlementDays > 0.6 ? 0.35 : 0.1,
  ]);
  const missingCert = events.filter((e) => e.days > 2 && !e.certified).length;
  scored.push(["Certification gap", Math.min(0.4, missingCert * 0.2)]);

  const ranked = scored
    .filter((s) => s[1] > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (!ranked.length) ranked.push(["Fatigue and shift load", 0.2]);
  const sum = ranked.reduce((s, r) => s + r[1], 0) || 1;
  // Field is `label`, not `name`, so a reviewer grepping the data for employee
  // names never matches a driver.
  return ranked.map(([label, w]) => ({
    label,
    contribution: Number((w / sum).toFixed(2)),
    derivation: DRIVER_DERIVATION[label],
  }));
}

// ---- Build the cohort -------------------------------------------------------
const N = 4200;
const employees = [];
const eventsByEmployee = {};
for (let i = 0; i < N; i++) {
  const { record, events } = buildEmployee(i);
  employees.push(record);
  eventsByEmployee[record.employeeId] = events;
}

// ---- Aggregation (server-side, so the client never crunches events) --------
const SUPPRESS = 5; // small-cell suppression threshold: cells under 5 -> n<5
const periodStart = addMonths(TODAY, -12);
const inPeriod = (iso) => new Date(iso) >= periodStart && new Date(iso) <= TODAY;
const coverShareFor = (fn) => COST_MODEL.coverRequiredShare[fn] ?? 0.5;
const DAY_COST = COST_MODEL.paidSickDayCostRand;
const COVER_DAY_COST = coverDayCostRand();

function round(n, d = 0) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// Per-employee period rollups.
const empPeriod = new Map();
for (const emp of employees) {
  const evs = eventsByEmployee[emp.employeeId].filter((e) => inPeriod(e.startDate));
  let sickDays = 0, paidDays = 0, unpaidDays = 0, coverDays = 0, qualifying = 0, qualifyingCertified = 0;
  for (const e of evs) {
    sickDays += e.days;
    if (e.paid) paidDays += e.days; else unpaidDays += e.days;
    coverDays += e.days * coverShareFor(emp.function);
    if (e.days > 2) {
      qualifying += 1;
      if (e.certified) qualifyingCertified += 1;
    }
  }
  empPeriod.set(emp.employeeId, {
    scheduled: SCHEDULED_DAYS_PER_YEAR[emp.shiftPattern],
    sickDays, paidDays, unpaidDays, coverDays, qualifying, qualifyingCertified,
    spells: evs.length,
  });
}

function rollup(list) {
  let scheduled = 0, sickDays = 0, paidDays = 0, unpaidDays = 0, coverDays = 0, qualifying = 0, qualCert = 0;
  for (const emp of list) {
    const p = empPeriod.get(emp.employeeId);
    scheduled += p.scheduled;
    sickDays += p.sickDays;
    paidDays += p.paidDays;
    unpaidDays += p.unpaidDays;
    coverDays += p.coverDays;
    qualifying += p.qualifying;
    qualCert += p.qualifyingCertified;
  }
  const headcount = list.length;
  const rate = scheduled ? (sickDays / scheduled) * 100 : 0;
  const paidCost = paidDays * DAY_COST;
  const coverCost = coverDays * COVER_DAY_COST;
  const above75 = list.filter((e) => e.daysConsumed / e.entitlementDays >= 0.75).length;
  return {
    headcount,
    rate: round(rate, 1),
    sickDays: round(sickDays, 0),
    meanDaysPerEmployee: headcount ? round(sickDays / headcount, 1) : 0,
    certificationRate: qualifying ? round((qualCert / qualifying) * 100, 0) : null,
    pctAbove75Entitlement: headcount ? round((above75 / headcount) * 100, 0) : 0,
    paidCost: round(paidCost, 0),
    coverCost: round(coverCost, 0),
    indicativeCost: round(paidCost + coverCost, 0),
  };
}

// Headline (whole workforce).
const headlineRoll = rollup(employees);
const headline = {
  sickLeaveRatePct: headlineRoll.rate,
  totalSickDays: headlineRoll.sickDays,
  indicativeCostRand: headlineRoll.indicativeCost,
  paidCostRand: headlineRoll.paidCost,
  coverCostRand: headlineRoll.coverCost,
  certificationRatePct: headlineRoll.certificationRate,
  periodLabel: "Trailing 12 months",
};

// Entitlement burn distribution.
const burnBands = [
  { band: "0 to 25%", lo: 0, hi: 0.25, count: 0 },
  { band: "26 to 50%", lo: 0.25, hi: 0.5, count: 0 },
  { band: "51 to 75%", lo: 0.5, hi: 0.75, count: 0 },
  { band: "76 to 100%", lo: 0.75, hi: 1.0001, count: 0 },
  { band: "Exhausted", lo: 1.0001, hi: Infinity, count: 0 },
];
for (const e of employees) {
  const frac = e.daysConsumed / e.entitlementDays;
  const exhausted = e.daysRemaining <= 0;
  if (exhausted) burnBands[4].count++;
  else {
    for (const b of burnBands.slice(0, 4)) {
      if (frac >= b.lo && frac < b.hi) { b.count++; break; }
    }
  }
}
const exhaustionProjection = { in3Months: 0, in6Months: 0, in12Months: 0 };
for (const e of employees) {
  if (!e.projectedExhaustionDate) continue;
  const m = monthsBetween(TODAY, new Date(e.projectedExhaustionDate));
  if (m <= 3) exhaustionProjection.in3Months++;
  else if (m <= 6) exhaustionProjection.in6Months++;
  else if (m <= 12) exhaustionProjection.in12Months++;
}

// Condition mix by chapter (share of days vs share of spells), suppressed <5.
const chapterAgg = {};
let totalDays = 0, totalSpells = 0;
const chapterEmployees = {};
for (const emp of employees) {
  for (const e of eventsByEmployee[emp.employeeId].filter((x) => inPeriod(x.startDate))) {
    const c = e.icd10Chapter;
    chapterAgg[c] = chapterAgg[c] || { days: 0, spells: 0 };
    chapterAgg[c].days += e.days;
    chapterAgg[c].spells += 1;
    totalDays += e.days;
    totalSpells += 1;
    (chapterEmployees[c] = chapterEmployees[c] || new Set()).add(emp.employeeId);
  }
}
const conditionMix = ICD_CHAPTERS.map((c) => {
  const a = chapterAgg[c] || { days: 0, spells: 0 };
  const emps = chapterEmployees[c] ? chapterEmployees[c].size : 0;
  const suppressed = emps > 0 && emps < SUPPRESS;
  return {
    chapter: c,
    employees: emps,
    suppressed,
    shareDaysPct: suppressed ? null : round((a.days / (totalDays || 1)) * 100, 1),
    shareSpellsPct: suppressed ? null : round((a.spells / (totalSpells || 1)) * 100, 1),
  };
}).filter((r) => r.employees > 0)
  .sort((a, b) => (b.shareDaysPct || 0) - (a.shareDaysPct || 0));

// Concentration matrix: site x function, cell = sick leave rate, suppress <5.
const concentration = SITES.map((site) => ({
  site,
  cells: FUNCTIONS.map((fn) => {
    const list = employees.filter((e) => e.site === site && e.function === fn);
    if (list.length < SUPPRESS) {
      return { function: fn, headcount: list.length, suppressed: true, ratePct: null };
    }
    return { function: fn, headcount: list.length, suppressed: false, ratePct: rollup(list).rate };
  }),
}));

// Cohort summary: one row per (site, shiftPattern).
const cohortSummary = [];
for (const site of SITES) {
  for (const shift of SHIFTS) {
    const list = employees.filter((e) => e.site === site && e.shiftPattern === shift);
    if (!list.length) continue;
    const r = rollup(list);
    cohortSummary.push({
      site,
      shiftPattern: shift,
      headcount: r.headcount,
      ratePct: r.rate,
      meanDaysPerEmployee: r.meanDaysPerEmployee,
      certificationRatePct: r.certificationRate,
      pctAbove75Entitlement: r.pctAbove75Entitlement,
      indicativeCostRand: r.indicativeCost,
      suppressed: r.headcount < SUPPRESS,
    });
  }
}

// ---- Operations aggregates --------------------------------------------------
// Predicted next-30-day sick leave rate by site (indicative, modelled): recent
// rate with a mild seasonal uplift.
const SEASONAL_UPLIFT = 1.08; // indicative winter respiratory uplift
const predictedRateBySite = SITES.map((site) => {
  const list = employees.filter((e) => e.site === site);
  const base = rollup(list).rate;
  return { site, predictedRatePct: round(base * SEASONAL_UPLIFT, 1), headcount: list.length };
});

// Cover gap heatmap: next 28 days x (site, shift pattern). Projected unfilled
// backfill shifts per cell. Relief pool capacity is an indicative constant.
const RELIEF_POOL_SHIFTS_PER_DAY = 3; // indicative relief capacity per cohort/day
const coverCohorts = [];
for (const site of SITES) {
  for (const shift of SHIFTS) {
    if (shift === "Standard business hours") continue; // office roles are not backfilled shift-by-shift
    const list = employees.filter((e) => e.site === site && e.shiftPattern === shift);
    if (list.length < SUPPRESS) continue;
    coverCohorts.push({ site, shift, list });
  }
}
const coverGapHeatmap = coverCohorts.map(({ site, shift, list }) => {
  const dailyRate = (rollup(list).rate / 100) * SEASONAL_UPLIFT;
  const avgCoverShare =
    list.reduce((s, e) => s + coverShareFor(e.function), 0) / list.length;
  const days = [];
  for (let d = 0; d < 28; d++) {
    const date = addDays(TODAY, d + 1);
    const dow = date.getUTCDay(); // 0 Sun .. 6 Sat
    // Day shift eases on weekends; continuous / rotating run through.
    const weekendFactor = shift === "Day shift" && (dow === 0 || dow === 6) ? 0.4 : 1;
    const predictedAbsent = list.length * dailyRate * weekendFactor;
    const requiredCover = predictedAbsent * avgCoverShare;
    const gap = Math.max(0, Math.round(requiredCover - RELIEF_POOL_SHIFTS_PER_DAY));
    days.push(gap);
  }
  return { site, shiftPattern: shift, days };
});
const totalGapShifts = coverGapHeatmap.reduce((s, c) => s + c.days.reduce((a, b) => a + b, 0), 0);
const overtimeBackfillCostRand = round(totalGapShifts * COVER_DAY_COST, 0);

// Entitlement exhaustion forecast by cohort.
const exhaustionByCohort = [];
for (const site of SITES) {
  for (const shift of SHIFTS) {
    const list = employees.filter((e) => e.site === site && e.shiftPattern === shift);
    if (list.length < SUPPRESS) continue;
    const f = { in3Months: 0, in6Months: 0, in12Months: 0 };
    for (const e of list) {
      if (!e.projectedExhaustionDate) continue;
      const m = monthsBetween(TODAY, new Date(e.projectedExhaustionDate));
      if (m <= 3) f.in3Months++;
      else if (m <= 6) f.in6Months++;
      else if (m <= 12) f.in12Months++;
    }
    exhaustionByCohort.push({ site, shiftPattern: shift, headcount: list.length, ...f });
  }
}

// Return-to-work caseload.
const rtwCaseload = employees.filter((e) => e.rtwOpen).length;

// Certification compliance overall, by site, by practitioner type.
function certStats(evs) {
  let q = 0, c = 0;
  for (const e of evs) if (e.days > 2) { q++; if (e.certified) c++; }
  return { qualifying: q, certified: c, missing: q - c, ratePct: q ? round((c / q) * 100, 0) : null };
}
const allPeriodEvents = [];
for (const emp of employees) for (const e of eventsByEmployee[emp.employeeId]) if (inPeriod(e.startDate)) allPeriodEvents.push({ ...e, site: emp.site });
const certOverall = certStats(allPeriodEvents);
const certBySite = SITES.map((site) => ({ site, ...certStats(allPeriodEvents.filter((e) => e.site === site)) }));
const certByPractitioner = PRACTITIONERS.map((p) => ({
  practitionerType: p,
  ...certStats(allPeriodEvents.filter((e) => e.practitionerType === p)),
}));

// ---- Assemble + write -------------------------------------------------------
const aggregates = {
  headline,
  entitlementBurn: {
    bands: burnBands.map((b) => ({ band: b.band, count: b.count })),
    projection: exhaustionProjection,
  },
  conditionMix,
  concentration,
  cohortSummary,
  operations: {
    predictedRateBySite,
    coverGapHeatmap,
    overtimeBackfillCostRand,
    totalGapShifts,
    rtwCaseload,
    exhaustionByCohort,
    certification: { overall: certOverall, bySite: certBySite, byPractitioner: certByPractitioner },
  },
};

const meta = {
  generatedAt: isoDate(TODAY),
  today: isoDate(TODAY),
  cohortSize: N,
  siteCount: SITES.length,
  sites: SITES,
  functions: FUNCTIONS,
  shiftPatterns: SHIFTS,
  ageBands: AGE_BANDS,
  icd10Chapters: ICD_CHAPTERS,
  practitionerTypes: PRACTITIONERS,
  drivers: DRIVERS,
  suppressionThreshold: SUPPRESS,
  periodLabel: "Trailing 12 months",
  scheduledDaysPerYear: SCHEDULED_DAYS_PER_YEAR,
  cycleMonths: CYCLE_MONTHS,
  standardEntitlementDays: STANDARD_ENTITLEMENT,
  costModel: {
    paidSickDayCostRand: COST_MODEL.paidSickDayCostRand,
    overtimeBackfillMultiplier: COST_MODEL.overtimeBackfillMultiplier,
    reliefPoolShiftsPerDay: RELIEF_POOL_SHIFTS_PER_DAY,
    note: "All Rand figures are indicative and pre-data.",
  },
};

const header = `/*
  GENERATED FILE. Do not edit by hand.
  Produced by scripts/generate-sick-leave-data.mjs (npm run generate-data).
  Synthetic sample data only. No client data. No individual pattern features.
*/`;

// Lightweight selector rows: enough to render the case-view employee list
// without loading every full record. No names, ids only.
const selectorRows = employees.map((e) => ({
  employeeId: e.employeeId,
  site: e.site,
  function: e.function,
  shiftPattern: e.shiftPattern,
  riskTier: e.riskTier,
}));

// sampleData.js holds only meta + aggregates + the light selector list, so the
// portfolio and operations screens stay small. The heavy full records and the
// spell history load lazily with the clinical case view.
writeFileSync(
  join(OUT_DIR, "sampleData.js"),
  `${header}\nexport const meta = ${JSON.stringify(meta, null, 2)};\n\nexport const aggregates = ${JSON.stringify(aggregates, null, 2)};\n\nexport const employeeIndex = ${JSON.stringify(selectorRows)};\n`
);
writeFileSync(
  join(OUT_DIR, "sampleData.employees.js"),
  `${header}\n// Full employee records for the clinical case view only.\nexport const employees = ${JSON.stringify(employees)};\n`
);
writeFileSync(
  join(OUT_DIR, "sampleData.events.js"),
  `${header}\n// Per-employee spell history for the clinical case view only.\nexport const eventsByEmployee = ${JSON.stringify(eventsByEmployee)};\n`
);

console.log(
  `Wrote ${N} employees, ${Object.values(eventsByEmployee).reduce((s, a) => s + a.length, 0)} events.`
);
console.log(
  `Headline: rate ${headline.sickLeaveRatePct}%, ${headline.totalSickDays} sick days, R${headline.indicativeCostRand.toLocaleString()} indicative, cert ${headline.certificationRatePct}%.`
);
console.log(`RTW caseload ${rtwCaseload}, cover gap shifts (4wk) ${totalGapShifts}.`);
