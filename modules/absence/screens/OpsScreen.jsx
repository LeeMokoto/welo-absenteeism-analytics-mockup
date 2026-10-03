import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import Metric from "@/modules/sick-leave/components/Metric";
import { portfolio } from "../data/portfolio";
import { num, pct, randCompact, rand } from "@/modules/sick-leave/format";

/*
  Absence HR and operations, ported from the standalone dashboard.

  Cohort level throughout: the module data carries no individual records, so
  nothing here can resolve to a person.

  Framing note on the frequency section. Absence frequency and the Bradford
  index are attendance measures that are widely used punitively. They are used
  here to size how many people would be routed to a return-to-work conversation,
  which is a care process, and the copy says so. The band labels come from the
  pipeline; see the module guardrails and the note in the screen.
*/

export default function AbsenceOpsScreen() {
  const ops = portfolio.hr_ops || {};
  const h = ops.headline || {};
  const cover = ops.cover || {};
  const freq = ops.frequency || {};
  const rtw = ops.return_to_work || {};
  const byCohort = ops.by_cohort || [];
  const a = ops.assumptions || {};

  return (
    <section>
      <SectionHeader title="HR and operations" sub="Cover, overtime and return to work" />

      <div className="grid grid-4">
        <Metric
          label="Absence rate"
          value={pct((h.absence_rate || 0) * 100, 1)}
          unit="of scheduled days"
          hover={`${num(h.covered_lives)} covered lives in the scored population.`}
        />
        <Metric
          label="Cover gap"
          value={num(h.cover_gap_days_90d)}
          unit="days needing backfill, 90d"
        />
        <Metric
          label="Backfill cost"
          value={randCompact(h.backfill_cost_rand_90d)}
          unit="Rand, indicative, 90d"
          hover={`Day rate ${rand(a.day_rate_rand)} plus a cover premium of ${rand(a.cover_premium_rand)}.`}
        />
        <Metric
          label="Return to work"
          value={num(h.rtw_caseload)}
          unit="open caseload"
        />
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>
        Rand figures indicative. Cover and overtime are modelled projections, not live.
      </div>

      <div className="section grid grid-2">
        <div className="card">
          <div className="card-title">Cover and overtime</div>
          <p className="card-note">What the predicted absence costs to staff around.</p>
          <table className="data">
            <tbody>
              <tr><td>Predicted absent days, 90d</td><td>{num(cover.predicted_absent_days_90d)}</td></tr>
              <tr><td>Cover gap days, 90d</td><td>{num(cover.cover_gap_days_90d)}</td></tr>
              <tr><td>Backfill cost, 90d</td><td>{rand(cover.backfill_cost_rand_90d)}</td></tr>
              <tr><td>Mean overtime per 14 days</td><td>{cover.overtime_mean_14d} h</td></tr>
              <tr><td>On high overtime</td><td>{pct((cover.overtime_high_share || 0) * 100, 1)}</td></tr>
              <tr><td>Overtime hours, annual</td><td>{num(cover.overtime_annual_hours)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Return to work</div>
          <p className="card-note">The support caseload this absence implies.</p>
          <table className="data">
            <tbody>
              <tr><td>Open caseload</td><td>{num(rtw.rtw_caseload)}</td></tr>
              <tr><td>Share of covered lives</td><td>{pct((rtw.rtw_share || 0) * 100, 1)}</td></tr>
              <tr><td>Long gap since leave</td><td>{num(rtw.long_leave_gap_count)}</td></tr>
              <tr><td>Mean days since leave</td><td>{num(rtw.mean_days_since_leave)}</td></tr>
              <tr><td>Repeat absence</td><td>{num(rtw.repeat_absence_count)}</td></tr>
            </tbody>
          </table>
          <div className="indicative" style={{ marginTop: 10 }}>
            A long gap since leave is a rest signal, not a performance one.
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card-title">Absence frequency</div>
          <p className="card-note">
            How many people a frequency trigger would route to a return-to-work conversation.
            This sizes a support caseload: it is not a judgement about any individual, and the
            platform does not use these measures for attendance management.
          </p>
          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            <Stat label="Mean spells per year" value={freq.mean_spells_per_year} />
            <Stat label="Would meet a trigger" value={num(freq.trigger_count)} />
            <Stat label="Share of workforce" value={pct((freq.trigger_share || 0) * 100, 1)} />
          </div>
          <table className="data">
            <thead>
              <tr><th>Band</th><th>People</th><th>Share</th></tr>
            </thead>
            <tbody>
              {(freq.bands || []).map((b) => (
                <tr key={b.band}>
                  <td>{b.band}</td>
                  <td>{num(b.count)}</td>
                  <td>{pct((b.share || 0) * 100, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="indicative" style={{ marginTop: 10 }}>
            Band names are inherited from the pipeline and are under review.
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card-title">By operational cohort</div>
          <p className="card-note">
            Where the cover gap and overtime land. Cohorts under the threshold carry no figures.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Covered</th>
                <th>Cover gap, 90d</th>
                <th>Backfill cost</th>
                <th>Overtime / 14d</th>
                <th>RTW caseload</th>
                <th>Long leave gap</th>
              </tr>
            </thead>
            <tbody>
              {byCohort.map((c) =>
                c.suppressed ? (
                  <tr key={c.key}>
                    <td><strong>{c.label}</strong></td>
                    <td><span className="nlt5">n&lt;5</span></td>
                    <td colSpan={5} className="caption">
                      Suppressed, fewer than {c.suppressed_below} covered lives
                    </td>
                  </tr>
                ) : (
                  <tr key={c.key}>
                    <td><strong>{c.label}</strong></td>
                    <td>{num(c.count)}</td>
                    <td>{num(c.cover_gap_days_90d)}</td>
                    <td>{randCompact(c.backfill_cost_rand_90d)}</td>
                    <td>{c.overtime_mean_14d} h</td>
                    <td>{num(c.rtw_caseload)}</td>
                    <td>{num(c.long_leave_gap)}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="card cream">
          <div className="card-title">Assumptions</div>
          <p className="card-note" style={{ marginBottom: 0 }}>
            {num(a.work_days_per_year)} work days per year, a day rate of {rand(a.day_rate_rand)}{" "}
            and a cover premium of {rand(a.cover_premium_rand)}. A spell is assumed to run{" "}
            {a.spell_length_days} days, and a long gap since leave is {a.leave_gap_days} days.
            Every figure derived from these is indicative and pre-data.
          </p>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="caption">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
