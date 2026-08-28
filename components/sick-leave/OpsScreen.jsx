"use client";

import SectionHeader from "./SectionHeader";
import Metric from "./Metric";
import CoverGapHeatmap from "./CoverGapHeatmap";
import AgentPanel from "./AgentPanel";
import { AGENTS } from "@/lib/sick-leave/agentMeta";
import { buildCoordinatorContext } from "@/lib/sick-leave/context";
import { pct, num, randCompact, cell } from "@/lib/sick-leave/format";

export default function OpsScreen({ aggregates, meta, agentsAvailable }) {
  const ops = aggregates.operations;
  const cert = ops.certification;

  return (
    <section>
      <SectionHeader title="HR and operations" sub="Staffing, cover and cost" />

      <div className="grid grid-4">
        <Metric label="Cover gap" value={num(ops.totalGapShifts)} unit="shifts, next 4 weeks" />
        <Metric label="Overtime backfill" value={randCompact(ops.overtimeBackfillCostRand)} unit="Rand, indicative" />
        <Metric label="Return to work" value={num(ops.rtwCaseload)} unit="open cases" />
        <Metric
          label="Certification compliance"
          value={pct(cert.overall.ratePct, 0)}
          unit="% of qualifying spells"
          hover={`${num(cert.overall.missing)} qualifying spells missing a certificate.`}
        />
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>Rand figures indicative. Cover and overtime are modelled projections.</div>

      <div className="section grid grid-2">
        <div className="card">
          <div className="card-title">Predicted sick leave rate, next 30 days</div>
          <p className="card-note">By site. Modelled from recent rate with an indicative seasonal uplift.</p>
          <table className="data">
            <thead>
              <tr><th>Site</th><th>Headcount</th><th>Predicted rate</th></tr>
            </thead>
            <tbody>
              {ops.predictedRateBySite.map((r) => (
                <tr key={r.site}>
                  <td>{r.site}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{num(r.headcount)}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{pct(r.predictedRatePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="indicative" style={{ marginTop: 10 }}>Modelled, not live.</div>
        </div>

        <div className="card">
          <div className="card-title">Entitlement exhaustion forecast, by cohort</div>
          <p className="card-note">
            Which cohorts run out of paid entitlement and when. A staffing and cost signal, cohort
            level by nature.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="data" style={{ minWidth: 520 }}>
              <thead>
                <tr><th>Site</th><th>Shift pattern</th><th>3 mo</th><th>6 mo</th><th>12 mo</th></tr>
              </thead>
              <tbody>
                {ops.exhaustionByCohort.map((r) => (
                  <tr key={`${r.site}-${r.shiftPattern}`}>
                    <td>{r.site}</td>
                    <td>{r.shiftPattern}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{num(r.in3Months)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{num(r.in6Months)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{num(r.in12Months)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="section">
        <CoverGapHeatmap heatmap={ops.coverGapHeatmap} />
      </div>

      <div className="section">
        <div className="card">
          <div className="card-title">Certification compliance</div>
          <p className="card-note">
            A records and process quality measure, not evidence about any individual. BCEA section
            23 requires a certificate where an employee is absent for more than two consecutive
            days, or more than twice in an eight week period.
          </p>
          <div className="grid grid-2">
            <div>
              <div className="caption" style={{ marginBottom: 6 }}>By site</div>
              <table className="data">
                <thead><tr><th>Site</th><th>Cert rate</th><th>Missing</th></tr></thead>
                <tbody>
                  {cert.bySite.map((r) => (
                    <tr key={r.site}>
                      <td>{r.site}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{cell(r.ratePct, r.ratePct == null, (v) => pct(v, 0))}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{num(r.missing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="caption" style={{ marginBottom: 6 }}>By practitioner type</div>
              <table className="data">
                <thead><tr><th>Practitioner</th><th>Cert rate</th><th>Missing</th></tr></thead>
                <tbody>
                  {cert.byPractitioner.map((r) => (
                    <tr key={r.practitionerType}>
                      <td>{r.practitionerType}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{cell(r.ratePct, r.ratePct == null, (v) => pct(v, 0))}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{num(r.missing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <AgentPanel
          agent={AGENTS.coordinator.id}
          roleTag={AGENTS.coordinator.roleTag}
          description={AGENTS.coordinator.description}
          chips={AGENTS.coordinator.chips}
          available={agentsAvailable}
          getContext={() => buildCoordinatorContext(aggregates, meta)}
        />
      </div>
    </section>
  );
}
