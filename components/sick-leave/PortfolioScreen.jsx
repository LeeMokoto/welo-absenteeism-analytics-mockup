"use client";

import SectionHeader from "./SectionHeader";
import Metric from "./Metric";
import EntitlementBurn from "./EntitlementBurn";
import ConditionMix from "./ConditionMix";
import ConcentrationMatrix from "./ConcentrationMatrix";
import CohortTable from "./CohortTable";
import AgentPanel from "./AgentPanel";
import { AGENTS } from "@/lib/sick-leave/agentMeta";
import { buildAnalystContext } from "@/lib/sick-leave/context";
import { pct, num, randCompact, rand } from "@/lib/sick-leave/format";

export default function PortfolioScreen({ aggregates, meta, agentsAvailable }) {
  const h = aggregates.headline;

  return (
    <section>
      <SectionHeader title="Portfolio and cohorts" sub={`Where this concentrates, ${meta.periodLabel.toLowerCase()}`} />

      <div className="grid grid-4">
        <Metric label="Sick leave rate" value={pct(h.sickLeaveRatePct)} unit="% of scheduled days" />
        <Metric label="Total sick days" value={num(h.totalSickDays)} unit={meta.periodLabel} />
        <Metric
          label="Indicative cost"
          value={randCompact(h.indicativeCostRand)}
          unit="Rand, indicative"
          hover={`Paid days ${rand(h.paidCostRand)} plus cover ${rand(h.coverCostRand)}.`}
        />
        <Metric label="Certification rate" value={pct(h.certificationRatePct, 0)} unit="% of qualifying spells" />
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>
        Rand figures are indicative and pre-data. Rate is percent of scheduled days over the period.
      </div>

      <div className="section grid grid-2">
        <EntitlementBurn burn={aggregates.entitlementBurn} cohortSize={meta.cohortSize} />
        <ConditionMix mix={aggregates.conditionMix} />
      </div>

      <div className="section">
        <ConcentrationMatrix concentration={aggregates.concentration} functions={meta.functions} />
      </div>

      <div className="section">
        <CohortTable rows={aggregates.cohortSummary} />
      </div>

      <div className="section">
        <AgentPanel
          agent={AGENTS.analyst.id}
          roleTag={AGENTS.analyst.roleTag}
          description={AGENTS.analyst.description}
          chips={AGENTS.analyst.chips}
          available={agentsAvailable}
          getContext={() => buildAnalystContext(aggregates, meta)}
        />
      </div>
    </section>
  );
}
