import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import Metric from "@/modules/sick-leave/components/Metric";
import { portfolio } from "../data/portfolio";
import { num, pct, randCompact, rand } from "@/modules/sick-leave/format";

/*
  Absence outcomes and ROI, ported from the standalone dashboard.

  Reporting only. The lever panel and the enrolment projection that lived on the
  standalone screen do not travel with it: operating the model forwards is a
  different mode from reporting on it and belongs in its own destination.

  Three deliberate differences from the standalone screen.

  1. The quarterly seasonality bars are gone. Their values were hardcoded in the
     standalone markup and the feed carries no seasonality at all, so porting
     them would ship invented figures into the platform.

  2. The per-cohort addressable saving is not shown. The feed computes it as 20%
     of the 90 day cost while the headline figure is a share of the annual cost,
     so the two are not the same measure and must not sit in one table. The
     cohort breakdown here uses exposure and share of exposure, which are
     unambiguous. Unifying the basis is a pipeline change, not a screen change.

  3. Model metrics and provenance are shown, because an ROI claim is only as
     good as the model behind it and the platform commits to withdrawing a model
     that falls below its baseline.
*/

export default function AbsenceOutcomesScreen() {
  const h = portfolio.headline || {};
  const metrics = portfolio.model_metrics || {};
  const reg = metrics.regression || {};
  const clf = metrics.classification || {};
  const provenance = portfolio.data_provenance || [];
  const cohorts = (portfolio.cohorts || {}).cohort_load || [];
  const covered = portfolio.covered_cohort || {};
  const assume = (portfolio.hr_ops || {}).assumptions || {};
  const threshold = portfolio.suppression_threshold ?? 5;

  const exposure = h.absence_cost_exposure_rand || 0;
  const saving = h.projected_addressable_saving_rand || 0;
  const share = exposure ? (saving / exposure) * 100 : 0;

  // The cohort lens covers the mining population only; the benchmark rows in
  // the training data carry no cohort. State the gap rather than let the table
  // silently fail to add up to the headline.
  const cohortTotal = cohorts.reduce((a, c) => a + (c.cost_exposure_rand || 0), 0);
  const unassigned = (h.covered_lives || 0) - (covered.count || 0);

  return (
    <section>
      <SectionHeader title="Outcomes and ROI" sub="What the exposure is, and what is addressable" />

      <div className="grid grid-3">
        <Metric
          label="Annual absence exposure"
          value={randCompact(exposure)}
          unit="Rand, indicative"
          hover={`${num(h.predicted_absent_days_annual)} predicted absent days at a day rate of ${rand(assume.day_rate_rand)}.`}
        />
        <Metric
          label="Projected addressable saving"
          value={randCompact(saving)}
          unit="Rand, indicative, annual"
        />
        <Metric
          label="Share of exposure"
          value={pct(share, 1)}
          unit="addressable at the benchmark"
        />
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>
        Projected, not yet measured. A benchmark reduction applied to the high-risk band.
      </div>

      <div className="section">
        <div className="card">
          <div className="card-title">Exposure against addressable saving</div>
          <p className="card-note">
            {num(h.predicted_absent_days_annual)} predicted absent days a year across{" "}
            {num(h.covered_lives)} covered lives.
          </p>
          <Bar label="Current annual absence exposure" value={exposure} max={exposure} tone="baseline" />
          <Bar label="Projected addressable saving" value={saving} max={exposure} tone="saving" />
          <div className="indicative" style={{ marginTop: 14 }}>
            The saving is a projection from a benchmark, not an outcome that has been measured.
            Measured outcomes need a baseline period and a comparison, which arrive with the
            control centre.
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card-title">Where the exposure sits</div>
          <p className="card-note">
            By operational load. Cohorts under {threshold} carry no figures.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Covered</th>
                <th>Days, annual</th>
                <th>Annual exposure</th>
                <th>Share of cohort exposure</th>
                <th>Days / head / yr</th>
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
                    <td>{num(c.predicted_absent_days_annual)}</td>
                    <td>{randCompact(c.cost_exposure_rand)}</td>
                    <td>
                      {cohortTotal
                        ? pct(((c.cost_exposure_rand || 0) / cohortTotal) * 100, 1)
                        : "n/a"}
                    </td>
                    <td>{c.absent_days_per_head_annual}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          {unassigned > 0 ? (
            <div className="indicative" style={{ marginTop: 10 }}>
              The cohort lens covers {num(covered.count)} lives, {randCompact(cohortTotal)} of
              exposure. The remaining {num(unassigned)} lives come from the public benchmark set
              and carry no mining cohort, which is why the rows above do not add up to the
              headline.
            </div>
          ) : null}
        </div>
      </div>

      <div className="section grid grid-2">
        <div className="card">
          <div className="card-title">The model behind these figures</div>
          <p className="card-note">
            An ROI figure is only as good as the model that produced it, so the model's own
            measures are reported beside it.
          </p>
          <table className="data">
            <tbody>
              <tr><td>Training rows</td><td>{num(reg.n_train)}</td></tr>
              <tr><td>Mean absolute error, days</td><td>{reg.cv_mae}</td></tr>
              <tr><td>R squared</td><td>{reg.cv_r2}</td></tr>
              <tr><td>Mean absence, days</td><td>{reg.target_mean}</td></tr>
              <tr><td>Balanced accuracy, bands</td><td>{clf.cv_balanced_accuracy}</td></tr>
              <tr><td>ROC AUC, macro</td><td>{clf.cv_roc_auc_macro_ovr}</td></tr>
            </tbody>
          </table>
          <div className="indicative" style={{ marginTop: 10 }}>
            Cross-validated. A tenant model is backtested against a naive baseline before its
            predictions are served, and withdrawn if it falls below that baseline.
          </div>
        </div>

        <div className="card cream">
          <div className="card-title">Provenance and assumptions</div>
          <p className="card-note">What the model was trained on, and what the Rand figures rest on.</p>
          <table className="data">
            <thead>
              <tr><th>Training source</th><th>Rows</th></tr>
            </thead>
            <tbody>
              {provenance.map((p) => (
                <tr key={p.source}>
                  <td style={{ whiteSpace: "normal" }}>{p.source}</td>
                  <td>{num(p.rows)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="card-note" style={{ marginTop: 14, marginBottom: 0 }}>
            {num(assume.work_days_per_year)} work days per year at a day rate of{" "}
            {rand(assume.day_rate_rand)}. No client data has been used to train this model.
          </p>
        </div>
      </div>
    </section>
  );
}

function Bar({ label, value, max, tone }) {
  const width = max ? Math.max(1, (value / max) * 100) : 0;
  return (
    <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span className="caption">{label}</span>
        <span className="caption">{rand(value)}</span>
      </div>
      <div className="bar-track" style={{ height: 18 }}>
        <div
          className={"bar-fill" + (tone === "saving" ? "" : " soft")}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
