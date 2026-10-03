"use client";

import { useState } from "react";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import { portfolio } from "../data/portfolio";
import { num, pct, randCompact } from "@/modules/sick-leave/format";

/*
  Absence cohorts, ported from the standalone dashboard.

  One deliberate difference from the original: the standalone screen let you
  drill from a cohort into the individuals inside it. This screen does not, and
  the module data it reads carries no individual records at all. A cohort screen
  serving per-person scores would contradict the module's own guardrail, so the
  drill-down belongs in the clinical view, not here.

  The lens is component state rather than a route: it is a filter within one
  screen, not a destination of its own.
*/

const BANDS = ["Critical", "High", "Medium", "Low"];

const concLevel = (s) =>
  s >= 0.2 ? "critical" : s >= 0.12 ? "high" : s >= 0.07 ? "medium" : "low";

export default function CohortsScreen() {
  const dimensions = portfolio.cohort_dimensions || [];
  const [lens, setLens] = useState(dimensions[0]?.key || "cohort_load");
  const dim = dimensions.find((d) => d.key === lens) || {};
  const cohorts = (portfolio.cohorts || {})[lens] || [];
  const threshold = portfolio.suppression_threshold ?? 5;

  return (
    <section>
      <SectionHeader title="Cohorts" sub="Compare the workforce through one lens at a time" />

      <div className="lens-toggle" role="tablist" aria-label="Cohort lens">
        {dimensions.map((d) => (
          <button
            key={d.key}
            role="tab"
            aria-selected={lens === d.key}
            className={"lens-btn" + (lens === d.key ? " active" : "")}
            onClick={() => setLens(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>
      {dim.blurb ? (
        <p className="card-note" style={{ marginTop: 12, maxWidth: 760 }}>{dim.blurb}</p>
      ) : null}

      <div className="section grid grid-3">
        {cohorts.map((c) =>
          c.suppressed ? (
            <div key={c.key} className="card">
              <div className="card-title">{c.label}</div>
              <div className="nlt5" style={{ marginTop: 6 }}>n&lt;5 covered lives</div>
              <p className="card-note" style={{ marginTop: 12, marginBottom: 0 }}>
                Suppressed: fewer than {c.suppressed_below} covered lives, so no figures are
                reported for this cohort.
              </p>
            </div>
          ) : (
            <div key={c.key} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <div>
                  <div className="card-title">{c.label}</div>
                  <div className="caption">{num(c.count)} covered lives</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: `var(--${concLevel(c.high_or_critical_share)})`,
                    }}
                  >
                    {pct((c.high_or_critical_share || 0) * 100, 1)}
                  </div>
                  <div className="caption">high / critical</div>
                </div>
              </div>

              <RiskBar counts={c.risk_counts} total={c.count} />

              <div className="cohort-stats">
                <Stat label="Days / head / yr" value={c.absent_days_per_head_annual} />
                <Stat label="Mean fatigue" value={c.mean_fatigue} />
                <Stat label="Annual exposure" value={randCompact(c.cost_exposure_rand)} />
                <Stat label="Addressable" value={randCompact(c.addressable_saving_rand)} />
              </div>
            </div>
          )
        )}
      </div>

      <div className="section">
        <div className="card">
          <div className="card-title">Comparison, {(dim.label || lens).toLowerCase()}</div>
          <p className="card-note">
            Cohorts under {threshold} carry no figures and are shown as n&lt;5.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Covered</th>
                <th>High or critical</th>
                <th>Days / head / yr</th>
                <th>Days, 90d</th>
                <th>Exposure</th>
                <th>Addressable</th>
                <th>Mean fatigue</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) =>
                c.suppressed ? (
                  <tr key={c.key}>
                    <td><strong>{c.label}</strong></td>
                    <td><span className="nlt5">n&lt;5</span></td>
                    <td colSpan={6} className="caption">
                      Suppressed, fewer than {c.suppressed_below} covered lives
                    </td>
                  </tr>
                ) : (
                  <tr key={c.key}>
                    <td><strong>{c.label}</strong></td>
                    <td>{num(c.count)}</td>
                    <td>
                      <span className={"tier " + tierFor(c.high_or_critical_share)}>
                        {num(c.high_or_critical_count)} · {pct((c.high_or_critical_share || 0) * 100, 1)}
                      </span>
                    </td>
                    <td>{c.absent_days_per_head_annual}</td>
                    <td>{num(c.predicted_absent_days_90d)}</td>
                    <td>{randCompact(c.cost_exposure_rand)}</td>
                    <td>{randCompact(c.addressable_saving_rand)}</td>
                    <td>{c.mean_fatigue}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          <div className="indicative" style={{ marginTop: 10 }}>
            Rand figures indicative. Risk is modelled, not live.
          </div>
        </div>
      </div>
    </section>
  );
}

function tierFor(share) {
  return share >= 0.2 ? "Elevated" : share >= 0.1 ? "Moderate" : "Low";
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="caption">{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

// Proportion of the cohort in each predicted band, as one bar.
function RiskBar({ counts, total }) {
  const t = total || 1;
  return (
    <div className="risk-bar" title="Share of this cohort by predicted band">
      {BANDS.map((b) => {
        const n = counts?.[b] || 0;
        if (!n) return null;
        return (
          <div
            key={b}
            className={"risk-seg " + b.toLowerCase()}
            style={{ flex: n / t }}
            title={`${b}: ${n}`}
          />
        );
      })}
    </div>
  );
}
