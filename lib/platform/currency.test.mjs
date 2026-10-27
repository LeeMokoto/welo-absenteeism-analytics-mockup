import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CURRENCY,
  DEFAULT_RATE,
  conversionNote,
  conversionTag,
  convert,
  currencyName,
  isCurrency,
  money,
  moneyCompact,
  normaliseCurrency,
  readRate,
} from "./currency.js";

/*
  These figures end up in a prospect's spreadsheet, so the tests are about the
  three ways a currency toggle misleads rather than about formatting.

  One, a rate with no date. Two, a converted figure that reads as more precise
  than the Rand figure it came from. Three, a suppressed cell that becomes a
  zero on the way through a formatter. The fourth group is hydration: this
  module renders on the server and in the browser and the two have to agree
  character for character.
*/

// --- The rate carries a date, or it is not used ----------------------------

test("a rate and its date are read together", () => {
  const r = readRate({ WELO_FX_ZAR_PER_USD: "17.2", WELO_FX_AS_OF: "2026-03-14" });
  assert.deepEqual(r, { zarPerUsd: 17.2, asOf: "2026-03-14" });
});

test("a rate without a date is refused, and so is the rate", () => {
  // Half the configuration is how a figure ends up carrying somebody else's
  // date: the rate would be current and the date beside it would be the
  // default's. Both fall back or neither does.
  const r = readRate({ WELO_FX_ZAR_PER_USD: "17.2" });
  assert.deepEqual(r, DEFAULT_RATE);
  assert.equal(r.zarPerUsd, DEFAULT_RATE.zarPerUsd);
});

test("a date without a rate is refused too", () => {
  assert.deepEqual(readRate({ WELO_FX_AS_OF: "2026-03-14" }), DEFAULT_RATE);
});

test("a rate that is not a positive number falls back", () => {
  for (const bad of ["0", "-3", "abc", "", "Infinity"]) {
    assert.deepEqual(
      readRate({ WELO_FX_ZAR_PER_USD: bad, WELO_FX_AS_OF: "2026-03-14" }),
      DEFAULT_RATE,
      `rate ${JSON.stringify(bad)} was accepted`,
    );
  }
});

test("a blank date is not a date", () => {
  assert.deepEqual(
    readRate({ WELO_FX_ZAR_PER_USD: "17.2", WELO_FX_AS_OF: "   " }),
    DEFAULT_RATE,
  );
});

test("an empty environment gives the dated default, not an undated one", () => {
  const r = readRate({});
  assert.ok(r.asOf, "the default rate has no date");
  assert.match(r.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

// --- Rand is the stored unit and the identity -------------------------------

test("Rand is the default and converting it does no arithmetic", () => {
  assert.equal(DEFAULT_CURRENCY, "ZAR");
  // Not just equal to the input: identical, so no rounding can creep into the
  // path every screen takes by default.
  assert.equal(convert(1_234_567, "ZAR", { zarPerUsd: 18.5, asOf: "x" }), 1_234_567);
});

test("dollars divide by the rate", () => {
  assert.equal(convert(18_500, "USD", { zarPerUsd: 18.5, asOf: "x" }), 1_000);
});

test("an unknown currency is treated as Rand rather than guessed at", () => {
  assert.equal(normaliseCurrency("GBP"), "ZAR");
  assert.equal(normaliseCurrency(undefined), "ZAR");
  assert.equal(convert(100, "GBP"), 100);
  assert.ok(!isCurrency("GBP"));
});

test("a missing amount is not a zero", () => {
  // A zero cost exposure is a claim. A figure the data does not carry is not.
  for (const nothing of [null, undefined, "", NaN]) {
    assert.equal(convert(nothing, "USD"), null);
    assert.equal(money(nothing, "USD"), "n/a");
    assert.equal(moneyCompact(nothing, "ZAR"), "n/a");
  }
});

// --- No invented precision --------------------------------------------------

test("neither currency shows cents, because the day rate does not support them", () => {
  assert.equal(money(2_100, "ZAR"), "R2,100");
  assert.equal(money(2_100, "USD", { zarPerUsd: 18.5, asOf: "x" }), "$114");
  assert.ok(!money(2_100, "USD", { zarPerUsd: 18.5, asOf: "x" }).includes("."));
});

test("the compact form buckets on the converted size, not the Rand size", () => {
  /*
    R12m is $649k at 18.5. Bucketing on the Rand magnitude would print "$0.6m",
    which reads as a rounder number than the data is. The threshold is applied
    after conversion so each currency reads in its own natural magnitude.
  */
  const rate = { zarPerUsd: 18.5, asOf: "x" };
  assert.equal(moneyCompact(12_000_000, "ZAR"), "R12.0m");
  assert.equal(moneyCompact(12_000_000, "USD", rate), "$649k");
});

test("the compact form stops at one decimal at millions and none below", () => {
  const rate = { zarPerUsd: 18.5, asOf: "x" };
  assert.equal(moneyCompact(1_240_000, "ZAR"), "R1.2m");
  assert.equal(moneyCompact(48_000, "ZAR"), "R48k");
  assert.equal(moneyCompact(640, "ZAR"), "R640");
  assert.equal(moneyCompact(640, "USD", rate), "$35");
});

test("a negative figure keeps its sign in both forms", () => {
  // The outcome screens carry a change, which can be a reduction.
  assert.equal(money(-45_000, "ZAR"), "R-45,000");
  assert.equal(moneyCompact(-45_000, "ZAR"), "R-45k");
});

// --- Hydration: the server and the browser must agree ----------------------

test("grouping is a plain comma, not a locale separator", () => {
  /*
    toLocaleString("en-ZA") returns a non-breaking space here and a comma
    elsewhere, depending on the runtime's ICU data. This module renders on the
    server and again in the browser, so a separator that differs between them
    is a hydration mismatch that looks identical on screen. It cost a day once
    already.
  */
  const out = money(1_234_567, "ZAR");
  assert.equal(out, "R1,234,567");
  assert.ok(!/[  \s]/.test(out), `non-breaking space in ${JSON.stringify(out)}`);
});

test("formatting is pure, so two calls cannot disagree", () => {
  assert.equal(money(1_234_567, "USD"), money(1_234_567, "USD"));
  assert.equal(moneyCompact(98_765_432, "USD"), moneyCompact(98_765_432, "USD"));
});

// --- What the interface says about a converted figure ----------------------

test("Rand carries no conversion caveat, so a screen can include it always", () => {
  assert.equal(conversionNote("ZAR"), null);
  assert.equal(conversionTag("ZAR"), null);
});

test("the dollar caveat names the rate, the date and the stacked uncertainty", () => {
  const note = conversionNote("USD", { zarPerUsd: 17.2, asOf: "2026-03-14" });
  assert.match(note, /17\.2/);
  assert.match(note, /2026-03-14/);
  // The Rand figures are already indicative. A dollar figure carries that and
  // the rate, and the caveat has to say both or it understates the second.
  assert.match(note, /indicative/);
  assert.match(note, /stored and computed in/);
});

test("the short tag carries the rate and its date too", () => {
  const tag = conversionTag("USD", { zarPerUsd: 17.2, asOf: "2026-03-14" });
  assert.match(tag, /17\.2/);
  assert.match(tag, /2026-03-14/);
});

test("the unit is named in words for a tile's unit line", () => {
  assert.equal(currencyName("ZAR"), "Rand");
  assert.equal(currencyName("USD"), "US dollars");
  assert.equal(currencyName("GBP"), "Rand");
});
