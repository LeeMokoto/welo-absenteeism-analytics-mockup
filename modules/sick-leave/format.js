/*
  Presentation helpers for everything that is not money.

  Money is deliberately absent. This file used to export `rand` and
  `randCompact`, which hardcoded the symbol, and every screen called them
  directly. That is why the currency toggle took a file-by-file conversion
  rather than one change: the unit was baked into sixteen render sites.

  Money now goes through lib/platform/currency.js and the <Money> leaf, which
  know the display currency. The two helpers are gone rather than deprecated,
  so a new screen that reaches for them fails at import instead of quietly
  rendering a figure the toggle cannot reach.
*/

// Deterministic thousands grouping. We do NOT use toLocaleString here: its
// separator depends on the runtime's ICU data (Node vs the browser differ for
// en-ZA), which causes a server/client hydration mismatch. A fixed comma
// separator renders identically everywhere.
export function groupInt(value) {
  if (value == null) return "n/a";
  const n = Math.round(value);
  const sign = n < 0 ? "-" : "";
  return sign + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function pct(value, dp = 1) {
  if (value == null) return "n/a";
  return value.toFixed(dp) + "%";
}

export function num(value) {
  if (value == null) return "n/a";
  return groupInt(value);
}

export function days(value, dp = 1) {
  if (value == null) return "n/a";
  return Number(value).toFixed(dp).replace(/\.0$/, "");
}

// Small-cell display: a suppressed cell reads n<5, never a number.
export function cell(value, suppressed, render) {
  if (suppressed) return "n<5";
  return render ? render(value) : value;
}
