import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import Metric from "@/modules/sick-leave/components/Metric";
import { portfolio } from "../data/portfolio";
import { num, pct, randCompact, rand } from "@/modules/sick-leave/format";

/*
  Absence portfolio, ported from the standalone dashboard into the shell.

  Cohort level throughout. Suppressed cohorts arrive from the feed with no
  figures at all and render as n<5, so this screen cannot show a number for a
  cohort the pipeline withheld.
*/

const LENS_LABEL = Object.fromEntries(
  (portfolio.cohort_dimensions || []).map((d) => [d.key, d.label])
);

export default function AbsencePortfolioScreen({ lens = "cohort_load" }) {
  const h = portfolio.headline || {};
  const threshold = portfolio.suppression_threshold ?? 5;
  const cohorts = (portfolio.cohorts || {})[lens] || [];
  const bands = portfolio.risk_distribution || [];

  return (
    <section>
      <SectionHeader title="Portfolio and cohorts" sub="Where absence and cost concentrate" />

      <div className="grid grid-4">
        <Metric label="Covered lives" value={num(h.covered_lives)} unit="in the covered workforce" />
        <Metric
          label="Predicted absent days"
          value={num(h.predicted_absent_days_90d)}
          unit="next 90 days"
          hover={`${num(h.predicted_absent_days_annual)} days annualised.`}
        />
        <Metric
          label="Cost exposure"
          value={randCompact(h.absence_cost_exposure_rand)}
          unit="Rand, indicative, annual"
          hover={`Addressable saving ${rand(h.projected_addressable_saving_rand)}.`}
        />
        <Metric
          label="High or critical fatigue"
          value={pct((h.fatigue_high_or_critical_share || 0) * 100, 0)}
          unit="share of covered lives"
        />
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>
        Rand figures are indicative and pre-data. Risk is modelled, not live.
      </div>

      <div className="section grid grid-2">
        <div className="card">
          <div className="card-title">Risk distribution</div>
          <p className="card-note">Share of the covered workforce in each predicted band.</p>
          <div style={{ display: "grid", gap: 8 }}>
            {bands.map((b) => (
              <div key={b.band} className="condition-row">
                <span className="caption">{b.band}</span>
                <div className="condition-bar-row">
                  <div className="bar-track" style={{ height: 12 }}>
                    <div
                      className={"bar-fill" + (b.band === "Low" || b.band === "Medium" ? " soft" : "")}
                      style={{ width: `${Math.min(100, (b.share || 0) * 100 * 2.2)}%` }}
                    />
                  </div>
                  <span className="caption" style={{ textAlign: "right" }}>
                    {pct((b.share || 0) * 100, 1)} · {num(b.count)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card cream">
          <div className="card-title">Covered cohort</div>
          <p className="card-note">The scored population behind these figures.</p>
          <table className="data">
            <tbody>
              <tr><td>Scored individuals</td><td>{num(portfolio.covered_cohort?.count)}</td></tr>
              <tr><td>Predicted absent days, 90d</td><td>{num(portfolio.covered_cohort?.predicted_absent_days_90d)}</td></tr>
              <tr><td>High or critical</td><td>{num(portfolio.covered_cohort?.high_or_critical_count)}</td></tr>
              <tr><td>Suppression threshold</td><td>{threshold}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card-title">Cohort summary, {(LENS_LABEL[lens] || lens).toLowerCase()}</div>
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
                <th>Exposure</th>
                <th>Mean fatigue</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) =>
                c.suppressed ? (
                  <tr key={c.key}>
                    <td><strong>{c.label}</strong></td>
                    <td><span className="nlt5">n&lt;5</span></td>
                    <td colSpan={4} className="caption">
                      Suppressed, fewer than {c.suppressed_below} covered lives
                    </td>
                  </tr>
                ) : (
                  <tr key={c.key}>
                    <td><strong>{c.label}</strong></td>
                    <td>{num(c.count)}</td>
                    <td>{pct((c.high_or_critical_share || 0) * 100, 1)}</td>
                    <td>{c.absent_days_per_head_annual}</td>
                    <td>{randCompact(c.cost_exposure_rand)}</td>
                    <td>{c.mean_fatigue}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          <div className="indicative" style={{ marginTop: 10 }}>Rand figures indicative.</div>
        </div>
      </div>
    </section>
  );
}
