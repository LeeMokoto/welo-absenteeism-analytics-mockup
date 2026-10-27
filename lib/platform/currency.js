/*
  Currency display.

  Every amount in this platform is stored and computed in Rand, because that is
  the unit the cost model is written in and the unit a South African employer
  thinks in. Display converts on the fly. Nothing is ever stored converted: a
  figure held in two currencies is a figure that disagrees with itself the first
  time a rate moves.

  Three things this does that a plain formatter would not.

  **The rate carries a date.** `asOf` travels with it and the interface shows it
  whenever a converted figure is on screen. An exchange rate with no date is a
  stale number pretending to be current, and these figures end up in a
  prospect's spreadsheet. The rate is configuration, so a deployment sets both
  together or neither.

  **Converting an indicative figure compounds two uncertainties.** The Rand
  figures are already indicative, built on a placeholder day rate in
  modules/sick-leave/costModel.js. In USD they also carry the rate. The
  interface says so rather than letting a converted number look more precise
  than the one it came from.

  **Rounding is deliberate at each magnitude.** A compact USD figure to one
  decimal place implies a precision the day rate does not support, so the
  compact form stays coarse and the full form stays whole-unit.

  Pure and framework-free, so the same answers come from the provider, a server
  render and a test.
*/

export const ZAR = "ZAR";
export const USD = "USD";
export const CURRENCY_CODES = [ZAR, USD];

export const DEFAULT_CURRENCY = ZAR;

/*
  Rand per one US dollar, with the date it was taken.

  Defaults rather than a live feed, deliberately: a demo that fetched a rate at
  render time would show a different number on every reload and would fail
  quietly when the feed did. A figure somebody is going to screenshot should be
  stable and dated.
*/
export const DEFAULT_RATE = { zarPerUsd: 18.5, asOf: "2026-10-01" };

export function readRate(env = {}) {
  const raw = Number(env.WELO_FX_ZAR_PER_USD);
  const asOf = String(env.WELO_FX_AS_OF || "").trim();

  // A rate without a date is refused back to the default, both of them. Half
  // the configuration is how a converted figure ends up carrying somebody
  // else's date.
  if (!Number.isFinite(raw) || raw <= 0 || !asOf) return DEFAULT_RATE;
  return { zarPerUsd: raw, asOf };
}

export function isCurrency(code) {
  return CURRENCY_CODES.includes(String(code || "").toUpperCase());
}

export function normaliseCurrency(code) {
  const upper = String(code || "").toUpperCase();
  return isCurrency(upper) ? upper : DEFAULT_CURRENCY;
}

export const SYMBOL = { [ZAR]: "R", [USD]: "$" };

/*
  The unit named in words, for a tile's unit line.

  Only this noun form exists. Prose that used to read "Rand figures are
  indicative" is written currency-neutral instead, because an adjectival form
  of each currency is a second vocabulary to keep in step and the sentence does
  not need it: the caveat is about the figures, not the unit.
*/
export const NAME = { [ZAR]: "Rand", [USD]: "US dollars" };

export function currencyName(code) {
  return NAME[normaliseCurrency(code)];
}

/*
  Convert a Rand amount for display. ZAR is the identity, so the common path
  does no arithmetic at all and cannot introduce a rounding difference.
*/
export function convert(zar, code, rate = DEFAULT_RATE) {
  if (zar == null) return null;
  // An empty or blank string is a field the extract does not carry, and
  // Number("") is 0. Left to itself that renders as R0, which is a claim the
  // data has not made. A missing figure stays missing and shows as n/a.
  if (typeof zar === "string" && zar.trim() === "") return null;
  const amount = Number(zar);
  if (!Number.isFinite(amount)) return null;
  if (normaliseCurrency(code) === ZAR) return amount;
  const perUsd = Number(rate?.zarPerUsd) || DEFAULT_RATE.zarPerUsd;
  return amount / perUsd;
}

// Deterministic thousands grouping. Not toLocaleString: its separator depends
// on the runtime's ICU data, which differs between Node and the browser and
// produces a hydration mismatch. This file is rendered on both.
function groupInt(value) {
  const n = Math.round(value);
  const sign = n < 0 ? "-" : "";
  return sign + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/*
  The exact form: symbol and whole units. No decimals in either currency,
  because the underlying day rate is a round placeholder and cents on top of it
  would be invented precision.
*/
export function money(zar, code = DEFAULT_CURRENCY, rate = DEFAULT_RATE) {
  const value = convert(zar, code, rate);
  if (value == null) return "n/a";
  const c = normaliseCurrency(code);
  return SYMBOL[c] + groupInt(value);
}

/*
  The compact form, for a headline tile.

  Thresholds are applied after conversion, so a figure near a boundary reads
  naturally in both currencies rather than being bucketed by its Rand size. One
  decimal at millions, none below: enough to distinguish 1.2m from 1.8m and no
  more than the inputs support.
*/
export function moneyCompact(zar, code = DEFAULT_CURRENCY, rate = DEFAULT_RATE) {
  const value = convert(zar, code, rate);
  if (value == null) return "n/a";
  const c = normaliseCurrency(code);
  const sym = SYMBOL[c];
  const abs = Math.abs(value);

  if (abs >= 1_000_000_000) return sym + (value / 1_000_000_000).toFixed(1) + "bn";
  if (abs >= 1_000_000) return sym + (value / 1_000_000).toFixed(1) + "m";
  if (abs >= 1_000) return sym + Math.round(value / 1_000) + "k";
  return sym + Math.round(value);
}

/*
  What the interface says when a converted figure is on screen.

  Returns null for Rand: the source unit needs no caveat beyond the indicative
  one the screens already carry. For USD it names the rate, its date, and the
  fact that two uncertainties are now stacked.
*/
export function conversionNote(code, rate = DEFAULT_RATE) {
  if (normaliseCurrency(code) === ZAR) return null;
  return (
    `Converted from Rand at ${rate.zarPerUsd} per US dollar, the rate as at ${rate.asOf}. ` +
    `The Rand figures are already indicative, so a dollar figure carries both that assumption and this rate. ` +
    `Rand is the unit everything is stored and computed in.`
  );
}

// A short version for a tile, where the long note would not fit.
export function conversionTag(code, rate = DEFAULT_RATE) {
  if (normaliseCurrency(code) === ZAR) return null;
  return `at ${rate.zarPerUsd}/USD, ${rate.asOf}`;
}
