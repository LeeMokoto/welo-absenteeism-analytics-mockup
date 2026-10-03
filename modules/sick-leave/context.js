/*
  Builds the compact JSON context objects passed to the agents. The agent
  reasons over this object and nothing else (grounding). These builders assemble
  only the figures already on the corresponding screen, at cohort level for the
  analyst and coordinator, and one record for the case assistant.
*/

export function buildAnalystContext(aggregates, meta) {
  return {
    note: "All Rand figures are indicative and pre-data. Cohort level only.",
    period: meta.periodLabel,
    headline: aggregates.headline,
    entitlementBurn: aggregates.entitlementBurn,
    conditionMixByChapter: aggregates.conditionMix,
    concentrationMatrix: aggregates.concentration,
    cohortSummary: aggregates.cohortSummary,
  };
}

export function buildCoordinatorContext(aggregates, meta) {
  const ops = aggregates.operations;
  return {
    note: "All Rand figures are indicative and pre-data. Cohort, site and shift level only.",
    period: meta.periodLabel,
    predictedSickLeaveRateBySite: ops.predictedRateBySite,
    coverGapHeatmapNext28Days: ops.coverGapHeatmap,
    totalCoverGapShifts: ops.totalGapShifts,
    overtimeBackfillCostRandIndicative: ops.overtimeBackfillCostRand,
    returnToWorkCaseload: ops.rtwCaseload,
    entitlementExhaustionForecastByCohort: ops.exhaustionByCohort,
    certificationCompliance: ops.certification,
  };
}

// The case context is a single de-identified record plus its spell history at
// chapter level. No name, no free text. Nothing else is sent.
export function buildCaseContext(record, events) {
  return {
    note: "One synthetic employee record. Care and support use only. Not for any employment decision.",
    employeeId: record.employeeId,
    site: record.site,
    function: record.function,
    shiftPattern: record.shiftPattern,
    tenureBand: tenureBand(record.tenureMonths),
    ageBand: record.ageBand,
    entitlement: {
      entitlementDays: record.entitlementDays,
      daysConsumed: record.daysConsumed,
      daysRemaining: record.daysRemaining,
      cycleStartDate: record.cycleStartDate,
      projectedExhaustionDate: record.projectedExhaustionDate,
      framing: "Planning context for the clinician, not a warning about the employee.",
    },
    model: {
      label: "MODELLED",
      riskScore: record.riskScore,
      riskTier: record.riskTier,
      drivers: record.drivers,
    },
    absenceHistoryByChapter: events.map((e) => ({
      startDate: e.startDate,
      days: e.days,
      paid: e.paid,
      certified: e.certified,
      practitionerType: e.practitionerType,
      icd10Chapter: e.icd10Chapter,
    })),
    availableCarePathways: [
      "Medical aid chronic programme",
      "On-site clinic",
      "Occupational health",
      "Employee assistance programme",
    ],
  };
}

function tenureBand(months) {
  if (months < 12) return "Under 1 year";
  if (months < 36) return "1 to 3 years";
  if (months < 84) return "3 to 7 years";
  if (months < 180) return "7 to 15 years";
  return "15 years or more";
}
