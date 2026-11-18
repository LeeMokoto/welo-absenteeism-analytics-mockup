/*
  Reading the demand block: how busy each department is, beside how much of
  its staff is expected to be off, at four timescales.

  The block is built in model/demand.py and only a tenant whose data has
  departments carries one. These helpers are pure so the screen, the agent tool
  and the tests read it the same way. No sector's words are written here: the
  department names, the measure label and the timescale labels all come from
  the data.
*/

export const GRAINS = ["year", "month", "week", "day"];

/*
  What each timescale is for. Generic on purpose: these are the decisions a
  manager takes at each horizon in any shift-based workforce.
*/
export const GRAIN_DECISIONS = {
  year: "Seasonal hiring, and when leave can be taken",
  month: "Standby cover booked ahead of the busiest days",
  week: "The weekly roster template",
  day: "Shift start times and split-shift design",
};

export function hasDemand(portfolio) {
  const d = portfolio?.demand;
  return Boolean(d && d.overall && Array.isArray(d.departments) && d.labels);
}

export function departmentLabels(demand) {
  return (demand?.departments || []).map((d) => d.label);
}

/*
  One view: a timescale for the whole workforce, or for one department. Rows
  are in calendar order. An unknown department or timescale returns null
  rather than falling back, so a caller cannot mistake one department's
  figures for another's.
*/
export function demandView(demand, grain, department = null) {
  if (!demand || !GRAINS.includes(grain)) return null;
  const source = department ? (demand.departments || []).find((d) => d.label === department) : demand.overall;
  if (!source) return null;
  const g = source.grains?.[grain];
  const labels = demand.labels?.[grain];
  if (!g || !labels) return null;
  const rows = labels.map((label, i) => ({
    label,
    demand: g.demand[i],
    absence_rate: g.absence_rate[i],
    pressure: Boolean(g.pressure[i]),
  }));
  return {
    grain,
    department,
    grain_label: demand.grain_labels?.[grain] || grain,
    decision: GRAIN_DECISIONS[grain],
    absence_rate_annual: source.absence_rate_annual,
    rows,
    pressure: rows.filter((r) => r.pressure).map((r) => r.label),
    peak_absence_rate: Math.max(...rows.map((r) => r.absence_rate)),
  };
}
