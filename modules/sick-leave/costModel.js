/*
  Cost model for the Sick Leave Intelligence dashboard.

  EVERY value here is INDICATIVE and PRE-DATA. These are placeholder constants
  chosen to look plausible for a South African industrial employer with a
  shift-based frontline workforce. They are not drawn from any client payroll
  and must be labelled "indicative" wherever a Rand figure derived from them
  appears in the UI. Edit here and nowhere else.
*/

// Explicit extension: this module is loaded both by webpack and directly by
// the Node data generator, and Node's ESM resolver does not infer it.
import { COVER_REQUIRED_SHARE } from "./dimensions.js";

export const COST_MODEL = {
  // Direct cost of one paid sick day: average fully-loaded salary cost per day.
  paidSickDayCostRand: 2100,

  // Cover cost: when an absence must be backfilled, the relief is paid at an
  // overtime multiplier of the day cost.
  overtimeBackfillMultiplier: 1.5,

  // Share of absences, by function, that actually require operational backfill.
  // Defined with the functions themselves in dimensions.js, because the share
  // is a property of the work rather than of the costing: a shift post is
  // filled or the plant runs short, and an office absence is absorbed.
  coverRequiredShare: COVER_REQUIRED_SHARE,

  // Unpaid conversion exposure: once entitlement is exhausted, further sick days
  // fall outside paid entitlement. This is the employee's financial strain, and
  // we surface it as a care and planning signal, not a saving.
  unpaidDayValueRand: 2100,
};

export function coverDayCostRand() {
  return COST_MODEL.paidSickDayCostRand * COST_MODEL.overtimeBackfillMultiplier;
}
