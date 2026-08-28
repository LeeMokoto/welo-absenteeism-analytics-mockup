/*
  Cost model for the Sick Leave Intelligence dashboard.

  EVERY value here is INDICATIVE and PRE-DATA. These are placeholder constants
  chosen to look plausible for a South African mining division. They are not
  drawn from any client payroll and must be labelled "indicative" wherever a
  Rand figure derived from them appears in the UI. Edit here and nowhere else.
*/

export const COST_MODEL = {
  // Direct cost of one paid sick day: average fully-loaded salary cost per day.
  paidSickDayCostRand: 2100,

  // Cover cost: when an absence must be backfilled, the relief is paid at an
  // overtime multiplier of the day cost.
  overtimeBackfillMultiplier: 1.5,

  // Share of absences, by function, that actually require operational backfill
  // (an office role often does not; a shift-critical operations role does).
  coverRequiredShare: {
    "Mining Operations": 0.9,
    Processing: 0.85,
    "Engineering and Maintenance": 0.7,
    Logistics: 0.75,
    Administration: 0.15,
  },

  // Unpaid conversion exposure: once entitlement is exhausted, further sick days
  // fall outside paid entitlement. This is the employee's financial strain, and
  // we surface it as a care and planning signal, not a saving.
  unpaidDayValueRand: 2100,
};

export function coverDayCostRand() {
  return COST_MODEL.paidSickDayCostRand * COST_MODEL.overtimeBackfillMultiplier;
}
