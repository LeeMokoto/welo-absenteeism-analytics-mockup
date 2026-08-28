// Presentation helpers. All Rand output is indicative (see costModel.js).

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

export function rand(value) {
  if (value == null) return "n/a";
  return "R" + groupInt(value);
}

export function randCompact(value) {
  if (value == null) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return "R" + (value / 1_000_000).toFixed(1) + "m";
  if (abs >= 1_000) return "R" + (value / 1_000).toFixed(0) + "k";
  return "R" + Math.round(value);
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
