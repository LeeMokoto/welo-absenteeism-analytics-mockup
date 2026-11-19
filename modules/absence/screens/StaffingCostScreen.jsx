"use client";

import { useMemo, useState } from "react";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import Metric from "@/modules/sick-leave/components/Metric";
import { num, pct } from "@/modules/sick-leave/format";
import { CurrencyName, CurrencyNote, Money, useCurrency } from "@/components/platform/Currency";
import { dateLabel, departmentView, departmentNames, monthLabel, summary, timeline } from "../staffingCost";

/*
  Cost of short staffing.

  What short staffing has cost over the history, and what the next 90 days put
  at risk. Cover spend is what cover cost, so it is drawn solid. Lost revenue
  is an estimate, so it is drawn lighter and always carries its range. The
  forecast months are outlined rather than filled, so nobody reads a forecast
  as a record. Departments whose short shifts do not show up in revenue are
  counted, not priced.

  Every amount goes through the currency formatter, so the Rand and dollar
  toggle holds on the chart axis as well as in the tables.
*/

const W = 760;
const H = 230;
const PAD = { l: 58, r: 10, t: 12, b: 34 };

/*
  A range in words. Compact for millions; `exact` for amounts in the
  thousands, where compact rounding would turn R2,671 to R3,040 into
  "R3k to R3k" and hide the very spread a range is there to show.
*/
function MoneyRange({ r, exact = false }) {
  if (!r) return <>Not priced</>;
  return (
    <>
      <Money zar={r.low} compact={!exact} /> to <Money zar={r.high} compact={!exact} />
    </>
  );
}

function CostChart({ rows }) {
  const { moneyCompact } = useCurrency();
  const n = rows.length;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const step = iw / n;
  const bw = Math.min(20, step * 0.7);
  const max = Math.max(1, ...rows.map((r) => r.total_rand.high)) * 1.08;
  const y = (v) => PAD.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const firstForecast = rows.findIndex((r) => r.kind === "forecast");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cover spend and estimated lost revenue by month, with the forecast">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-mute)">
            {moneyCompact(t)}
          </text>
        </g>
      ))}
      {firstForecast > 0 && (
        <g>
          <line
            x1={PAD.l + firstForecast * step}
            x2={PAD.l + firstForecast * step}
            y1={PAD.t}
            y2={PAD.t + ih}
            stroke="var(--ink-faint)"
            strokeDasharray="3 3"
          />
          <text x={PAD.l + firstForecast * step + 4} y={PAD.t + 10} fontSize="11" fill="var(--ink-mute)">
            Forecast
          </text>
        </g>
      )}
      {rows.map((r, i) => {
        const x = PAD.l + i * step + (step - bw) / 2;
        const forecast = r.kind === "forecast";
        const cover = r.cover_spend_rand.mid;
        const lost = r.lost_revenue_rand.mid;
        const yCover = y(cover);
        const yTotal = y(cover + lost);
        const showLabel = ["-01", "-04", "-07", "-10"].some((q) => r.month.endsWith(q)) || i === 0 || i === firstForecast;
        const tip =
          `${monthLabel(r.month)}${forecast ? ` (forecast, ${r.days} days)` : ""}: ` +
          `cover ${moneyCompact(cover)}, lost revenue ${moneyCompact(r.lost_revenue_rand.low)} to ${moneyCompact(r.lost_revenue_rand.high)}`;
        return (
          <g key={r.month}>
            <title>{tip}</title>
            <rect
              x={x}
              y={yCover}
              width={bw}
              height={Math.max(1, PAD.t + ih - yCover)}
              fill={forecast ? "none" : "var(--ink-soft)"}
              stroke={forecast ? "var(--ink-soft)" : "none"}
              strokeDasharray={forecast ? "3 2" : undefined}
            />
            <rect
              x={x}
              y={yTotal}
              width={bw}
              height={Math.max(1, yCover - yTotal)}
              fill={forecast ? "none" : "var(--red-soft)"}
              stroke={forecast ? "var(--red)" : "none"}
              strokeDasharray={forecast ? "3 2" : undefined}
            />
            <line
              x1={x + bw / 2}
              x2={x + bw / 2}
              y1={y(r.total_rand.low)}
              y2={y(r.total_rand.high)}
              stroke="var(--red-deep)"
              strokeWidth="1.5"
            />
            {showLabel && (
              <text x={x + bw / 2} y={H - 18} textAnchor="middle" fontSize="11" fill="var(--ink-mute)">
                {monthLabel(r.month, { short: true })}
              </text>
            )}
            {(r.month.endsWith("-01") || i === 0) && (
              <text x={x + bw / 2} y={H - 5} textAnchor="middle" fontSize="10" fill="var(--ink-faint)">
                {r.month.slice(0, 4)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Legend() {
  const sw = (style) => (
    <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, marginRight: 6, verticalAlign: -2, ...style }} />
  );
  return (
    <div className="caption" style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 6 }}>
      <span>{sw({ background: "var(--ink-soft)" })}Cover spend</span>
      <span>{sw({ background: "var(--red-soft)" })}Lost revenue, estimated</span>
      <span>{sw({ border: "1px dashed var(--ink-soft)" })}Forecast</span>
      <span>{sw({ width: 2, background: "var(--red-deep)" })}Range</span>
    </div>
  );
}

export default function StaffingCostScreen({ block }) {
  const rows = useMemo(() => timeline(block), [block]);
  const s = useMemo(() => summary(block), [block]);
  const names = useMemo(() => departmentNames(block), [block]);
  const [dept, setDept] = useState("");
  const chosen = useMemo(() => (dept ? departmentView(block, dept) : null), [block, dept]);

  if (!block) {
    return (
      <section>
        <SectionHeader title="Cost of short staffing" sub="What gaps have cost, and what the next 90 days put at risk" />
        <div className="card">
          <div className="card-title">No staffing cost data for this tenant yet</div>
          <p className="card-note" style={{ marginBottom: 0 }}>
            This view needs the tenant's departments and their shift history: what was rostered, who was off,
            what cover was bought and what each service took. Once that data is connected, it shows what
            short staffing has cost and what the coming months put at risk.
          </p>
        </div>
      </section>
    );
  }

  const m = block.method || {};
  const v = block.validation;
  const matched = (m.matched_short_services || 0) + (m.unmatched_short_services || 0);
  const revenueLabel = block.measure?.revenue_label || "Revenue";

  return (
    <section>
      <SectionHeader title="Cost of short staffing" sub="What gaps have cost, and what the next 90 days put at risk" />

      <div className="grid grid-4">
        <Metric
          label="Cover spend"
          value={<Money zar={s.last_12_months.cover_spend_rand} compact />}
          unit={<><CurrencyName />, last 12 months</>}
          hover="What cover cost: shifts bought from casual and agency staff."
        />
        <Metric
          label="Lost revenue"
          value={<MoneyRange r={s.last_12_months.lost_revenue_rand} />}
          unit={<><CurrencyName />, estimated, last 12 months</>}
          hover={`${revenueLabel} that short-staffed services did not take, compared with fully staffed services like them.`}
        />
        <Metric
          label="Value at risk"
          value={<MoneyRange r={s.next_90_days.value_at_risk_rand} />}
          unit={<><CurrencyName />, next 90 days</>}
          hover="Cover the coming gaps will need, plus the revenue they will lose."
        />
        <Metric
          label="An uncovered shift lost"
          value={s.lost_revenue_per_short_shift_rand ? <MoneyRange r={s.lost_revenue_per_short_shift_rand} exact /> : "Not priced"}
          unit={<>of revenue; cover costs <Money zar={s.cover_rate_per_shift_rand} /></>}
          hover="Revenue lost per short shift in the departments whose staffing shows in revenue, against the cost of buying cover for that shift."
        />
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>{block.measure?.note}</div>

      {s.cover_pays !== null && (
        <div className="section card">
          <div className="card-title">{s.cover_pays ? "Buying cover paid" : "Buying cover did not always pay"}</div>
          <p className="card-note" style={{ marginBottom: 0 }}>
            {s.cover_pays ? (
              <>
                In the departments whose staffing shows in revenue, an uncovered shift lost{" "}
                <MoneyRange r={s.lost_revenue_per_short_shift_rand} exact /> of revenue, and cover for it costs{" "}
                <Money zar={s.cover_rate_per_shift_rand} />. Every gap left open there cost more than filling it.
              </>
            ) : (
              <>
                In at least one department whose staffing shows in revenue, the revenue an uncovered shift lost
                was not clearly more than the <Money zar={s.cover_rate_per_shift_rand} /> cover costs.
              </>
            )}
          </p>
        </div>
      )}

      <div className="section card">
        <div className="card-title">By month</div>
        <p className="card-note">
          {monthLabel(block.window.start)} to {monthLabel(block.window.end)}, then the forecast to {dateLabel(block.forecast.end)}.
        </p>
        <CostChart rows={rows} />
        <Legend />
      </div>

      <div className="section card">
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          By department
          <select
            className="cc-input"
            style={{ width: "auto", marginLeft: "auto" }}
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            aria-label="Department"
          >
            <option value="">All departments</option>
            {names.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <p className="card-note">Last 12 months, and the next 90 days.</p>
        <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Department</th>
              <th>Shifts short</th>
              <th>Shifts covered</th>
              <th>Cover spend</th>
              <th>Lost revenue, or impact</th>
              <th>At risk, 90 days</th>
            </tr>
          </thead>
          <tbody>
            {(chosen ? [chosen] : block.by_department).map((d) => {
              const ahead = chosen ? chosen.next_90_days : block.forecast.by_department.find((f) => f.label === d.label);
              return (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td className="cell-mono">{num(d.short_shifts)}</td>
                  <td className="cell-mono">{num(d.covered_shifts)}</td>
                  <td className="cell-mono"><Money zar={d.cover_spend_rand} compact /></td>
                  <td className={d.priced ? "cell-mono" : undefined} style={d.priced ? undefined : { whiteSpace: "normal" }}>
                    {d.priced ? (
                      <MoneyRange r={d.lost_revenue_rand} />
                    ) : d.indicator ? (
                      <span title={d.indicator.basis || undefined}>
                        {num(d.indicator.value)} {d.indicator.label.toLowerCase()}{" "}
                        <span className="caption">(not priced)</span>
                      </span>
                    ) : (
                      "Not priced"
                    )}
                  </td>
                  <td className="cell-mono">{ahead ? <MoneyRange r={ahead.value_at_risk_rand} /> : "None"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="section grid grid-2">
        <div className="card">
          <div className="card-title">By service</div>
          <p className="card-note">{revenueLabel}, last 12 months.</p>
          <table className="data">
            <thead>
              <tr>
                <th>Service</th>
                <th>Ran short</th>
                <th>Lost revenue</th>
              </tr>
            </thead>
            <tbody>
              {block.by_service.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="cell-mono">{pct(r.short_share * 100, 0)}</td>
                  <td className="cell-mono"><MoneyRange r={r.lost_revenue_rand} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">How lost revenue is estimated</div>
          <p className="card-note">
            Each service that ran short is compared with services that ran fully staffed at the same{" "}
            {(m.match_on || []).join(", ")}, within {m.window_days} days, with planned demand within{" "}
            {Math.round((m.demand_tolerance || 0) * 100)}%. What those services took per unit of demand, times
            this service's demand, is what it should have taken; the gap is the loss. The range runs from the{" "}
            {m.range_percentiles?.[0]}th to the {m.range_percentiles?.[1]}th percentile of many redraws.
          </p>
          {m.unmatched_short_services ? (
            <p className="card-note">
              {num(m.unmatched_short_services)} of {num(matched)} short services ({pct((m.unmatched_short_services / matched) * 100, 0)})
              had too few comparators and are left out, so the estimate is a floor.
            </p>
          ) : null}
          {v?.synthetic_only ? (
            <p className="card-note" style={{ marginBottom: 0 }}>
              <strong>Check on synthetic data.</strong> The true loss in this history is known:{" "}
              <Money zar={v.true_lost_revenue_rand} compact />. The method estimated{" "}
              <MoneyRange r={v.estimated_lost_revenue_rand} />, and the truth sat inside the monthly range in{" "}
              {v.months_true_within_range} of {v.months} months.
            </p>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <CurrencyNote />
      </div>
    </section>
  );
}
