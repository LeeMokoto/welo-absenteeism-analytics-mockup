/*
  When the Planner should be asked, and about what.

  One agent plans at every timescale; what changes is the horizon it is asked
  about. Three triggers decide when:

  - **Weekly**, before the roster goes out. Rosters for the coming week are
    published on ROSTER_PUBLISH_DAY; from Monday until then, the Planner is due
    a look at next week.
  - **Monthly**, the season view. In the last days of a month and the first of
    the next, it is due a look at the month ahead.
  - **Threshold**, when the forecast says the coming weeks will cost well more
    than usual. Only a tenant with a cost forecast (the staffing cost block)
    has one: the group's next month against its own last twelve, and each
    department's next 90 days against its own last year.

  Each trigger says whether it has fired, why, and the question to ask, with
  the horizon the Planner should draft for. Nothing here calls the agent or
  saves anything: proposals live in the browser until a shared store exists,
  so a trigger is a prompt to a person rather than a scheduled run. Pure, so
  the screen and the tests read the same rules.

  No sector words: department names come from the data.
*/

// Thursday, as getDay() counts it. Many rosters for the coming week go out
// then, which leaves Friday for swaps before the week starts.
export const ROSTER_PUBLISH_DAY = 4;
// How far above its own recent average a forecast must run to fire.
export const THRESHOLD = 0.2;
// The window around a month's turn when the season view is due.
export const MONTH_END_DAYS = 9;
export const MONTH_START_DAYS = 3;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function utcDate(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function longDate(d) {
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function monthName(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : String(ym);
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

/* The weekly trigger: due from Monday until the roster goes out. */
export function weeklyTrigger(today, { publishDay = ROSTER_PUBLISH_DAY } = {}) {
  const t = utcDate(today);
  const dow = t.getUTCDay();
  const daysToPublish = (publishDay - dow + 7) % 7;
  const publish = addDays(t, daysToPublish);
  // The week the roster covers starts the Monday after it goes out.
  const weekStart = addDays(publish, ((1 - publish.getUTCDay() + 7) % 7) || 7);
  const fired = dow >= 1 && dow <= publishDay;
  return {
    id: "weekly",
    kind: "schedule",
    horizon: "week",
    label: "Weekly, before the roster goes out",
    fired,
    due: iso(publish),
    reason: fired
      ? daysToPublish === 0
        ? `The roster for the week of ${longDate(weekStart)} goes out today.`
        : `The roster for the week of ${longDate(weekStart)} goes out on ${longDate(publish)}.`
      : `Next due on Monday, ahead of the roster going out on ${longDate(publish)}.`,
    question: `Plan the week of ${longDate(weekStart)} before its roster goes out: where will gaps land, which roster rules does it break, and what should change? Draft for the week horizon.`,
  };
}

/* The monthly trigger: due around the turn of the month. */
export function monthlyTrigger(today, { endDays = MONTH_END_DAYS, startDays = MONTH_START_DAYS } = {}) {
  const t = utcDate(today);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = t.getUTCDate();
  const lateInMonth = day > daysInMonth - endDays;
  const early = day <= startDays;
  // The month being planned: next month late in this one, this month early on.
  const target = lateInMonth ? new Date(Date.UTC(y, m + 1, 1)) : new Date(Date.UTC(y, m, 1));
  const label = `${MONTHS[target.getUTCMonth()]} ${target.getUTCFullYear()}`;
  const opens = new Date(Date.UTC(y, m, daysInMonth - endDays + 1));
  return {
    id: "monthly",
    kind: "schedule",
    horizon: "month",
    label: "Monthly, the season view",
    fired: lateInMonth || early,
    due: iso(lateInMonth || early ? t : opens),
    reason:
      lateInMonth
        ? `${label} is about to start.`
        : early
          ? `${label} has just started.`
          : `Next due from ${longDate(opens)}, ahead of the next month.`,
    question: `Plan ${label}: where will demand and absence collide, what will it cost, and which cover, roster or hiring change pays for itself? Draft for the month horizon.`,
  };
}

/*
  Threshold triggers, from the staffing cost forecast. Group: the next whole
  forecast month's daily value at risk against the last twelve months' daily
  cost (cover plus the mid estimate of lost revenue). Department: its next 90
  days at risk against its last twelve months scaled to 90 days.
*/
export function thresholdTriggers(block, { threshold = THRESHOLD, today = null } = {}) {
  if (!block?.history?.length || !block?.forecast) return [];
  // A forecast month that has already ended is history, not a warning.
  const thisMonth = today ? utcDate(today).toISOString().slice(0, 7) : null;
  const out = [];

  const last12 = block.history.slice(-12);
  const yearCost = last12.reduce((a, m) => a + m.cover_spend_rand + (m.lost_revenue_rand?.mid || 0), 0);
  const days = last12.reduce((a, m) => {
    const [y, mo] = m.month.split("-").map(Number);
    return a + new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }, 0);
  const perDay = days ? yearCost / days : 0;

  for (const m of block.forecast.months || []) {
    if (!m.days || !perDay) continue;
    if (thisMonth && m.month < thisMonth) continue;
    const ratio = m.value_at_risk_rand.mid / m.days / perDay - 1;
    if (ratio > threshold) {
      out.push({
        id: `threshold-${m.month}`,
        kind: "threshold",
        horizon: "month",
        label: `Forecast cost, ${monthName(m.month)}`,
        fired: true,
        due: null,
        ratio,
        reason: `${monthName(m.month)} is forecast to cost ${pct(ratio)} more a day than the last twelve months.`,
        question: `${monthName(m.month)} is forecast to cost ${pct(ratio)} more a day than usual. Which departments drive it, and what cover, roster or hiring change reduces it? Draft for the month horizon.`,
      });
    }
  }

  const past = new Map((block.by_department || []).map((d) => [d.label, d]));
  for (const f of block.forecast.by_department || []) {
    const p = past.get(f.label);
    if (!p) continue;
    const usual = ((p.cover_spend_rand || 0) + (p.lost_revenue_rand?.mid || 0)) * (block.forecast.days / 365);
    if (!usual) continue;
    const ratio = f.value_at_risk_rand.mid / usual - 1;
    if (ratio > threshold) {
      out.push({
        id: `threshold-department-${f.label}`,
        kind: "threshold",
        horizon: "season",
        label: `Forecast cost, ${f.label}`,
        fired: true,
        due: null,
        ratio,
        reason: `${f.label} is forecast to cost ${pct(ratio)} more over the next ${block.forecast.days} days than over a usual ${block.forecast.days} days.`,
        question: `${f.label} is forecast to cost ${pct(ratio)} more than usual over the next ${block.forecast.days} days. What is driving it, and what change reduces it? Draft for the season horizon.`,
      });
    }
  }

  return out.sort((a, b) => b.ratio - a.ratio);
}

/* Every trigger for a tenant, fired first. */
export function plannerTriggers(portfolio, { today = new Date(), threshold = THRESHOLD } = {}) {
  const triggers = [
    weeklyTrigger(today),
    monthlyTrigger(today),
    ...thresholdTriggers(portfolio?.staffing_cost, { threshold, today }),
  ];
  return triggers.sort((a, b) => Number(b.fired) - Number(a.fired));
}

/* Whether this tenant can fire a threshold trigger at all. */
export function hasThresholds(portfolio) {
  return Boolean(portfolio?.staffing_cost?.forecast);
}
