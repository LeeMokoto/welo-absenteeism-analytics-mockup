"use client";

import { useMemo, useState } from "react";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import { pct } from "@/modules/sick-leave/format";
import { GRAINS, demandView, departmentLabels } from "../demand";

/*
  Demand and cover.

  Where absence lands on a busy period. Two charts on one timeline: how busy
  the period is, as a share of its own peak, and how much of the staff is
  expected to be off, as a rate. They are different measures, so they are not
  drawn against one axis. A pressure point is marked the same way in both.

  The demand pattern is a benchmark until the tenant's own trading data is
  connected, and the screen says so in the words the data carries.
*/

const W = 720;
const H = 150;
const PAD = { l: 44, r: 8, t: 10, b: 24 };

function Bars({ rows, value, max, format, title, ariaLabel }) {
  const n = rows.length;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const step = iw / n;
  const bw = Math.min(28, step * 0.62);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return (
    <div>
      <div className="caption" style={{ marginBottom: 4 }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => {
          const y = PAD.t + ih - (t / max) * ih;
          return (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--line-soft)" strokeWidth="1" />
              <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--ink-mute)">
                {format(t)}
              </text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const v = value(r);
          const h = Math.max(1, (v / max) * ih);
          const x = PAD.l + i * step + (step - bw) / 2;
          return (
            <g key={r.label}>
              <rect
                x={x}
                y={PAD.t + ih - h}
                width={bw}
                height={h}
                rx="3"
                fill={r.pressure ? "var(--red)" : "var(--ink-faint)"}
              >
                <title>{`${r.label}: ${format(v)}${r.pressure ? " (pressure point)" : ""}`}</title>
              </rect>
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--ink-mute)">
                {r.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function DemandScreen({ demand }) {
  const [grain, setGrain] = useState("week");
  const [department, setDepartment] = useState("");
  const departments = useMemo(() => departmentLabels(demand), [demand]);
  const view = useMemo(() => demandView(demand, grain, department || null), [demand, grain, department]);

  if (!demand) {
    return (
      <section>
        <SectionHeader title="Demand and cover" sub="Where absence lands on busy periods" />
        <div className="card">
          <div className="card-title">No demand data for this tenant yet</div>
          <p className="card-note" style={{ marginBottom: 0 }}>
            This view needs the tenant's departments and a demand pattern for them. Once the tenant's
            trading or scheduling data is connected, it shows how busy each department is beside how
            much of its staff is expected to be off.
          </p>
        </div>
      </section>
    );
  }

  const m = demand.measure || {};
  const rule = demand.pressure_rule || {};
  const maxRate = Math.max(0.01, ...((view?.rows || []).map((r) => r.absence_rate)));

  return (
    <section>
      <SectionHeader title="Demand and cover" sub="Where absence lands on busy periods" />

      <div className="indicative">{m.note}</div>

      <div className="section" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {GRAINS.map((g) => (
          <button key={g} className={"lens-btn" + (g === grain ? " active" : "")} onClick={() => setGrain(g)}>
            {g[0].toUpperCase() + g.slice(1)}
          </button>
        ))}
        <select
          className="cc-input"
          style={{ width: "auto", marginLeft: "auto" }}
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          aria-label="Department"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {view ? (
        <>
          <div className="grid grid-3">
            <div>
              <div className="caption">Pressure points</div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>
                {view.pressure.length ? view.pressure.join(", ") : "None"}
              </div>
            </div>
            <div>
              <div className="caption">Expected absence, yearly average</div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>{pct(view.absence_rate_annual * 100, 1)}</div>
            </div>
            <div>
              <div className="caption">Decision this timescale drives</div>
              <div style={{ fontSize: 15, marginTop: 4 }}>{view.decision}</div>
            </div>
          </div>

          <div className="section card">
            <Bars
              rows={view.rows}
              value={(r) => r.demand}
              max={1}
              format={(v) => `${Math.round(v * 100)}%`}
              title={`${m.label}, as a share of the peak · ${view.grain_label}`}
              ariaLabel={`Demand by ${view.grain_label.toLowerCase()}, as a share of the peak`}
            />
            <div style={{ height: 12 }} />
            <Bars
              rows={view.rows}
              value={(r) => r.absence_rate}
              max={maxRate * 1.1}
              format={(v) => pct(v * 100, 1)}
              title={`Expected share of staff off · ${view.grain_label}`}
              ariaLabel={`Expected absence rate by ${view.grain_label.toLowerCase()}`}
            />
            <p className="card-note" style={{ marginTop: 10, marginBottom: 0 }}>
              Red marks a pressure point: demand at {Math.round((rule.demand_share_of_peak_at_least || 0.8) * 100)}% or
              more of its peak while expected absence is above {rule.absence_above || "its yearly average"}.
            </p>
          </div>
        </>
      ) : (
        <div className="section indicative">No figures for that view.</div>
      )}

      {demand.withheld_departments ? (
        <div className="caption" style={{ marginTop: 8 }}>
          {demand.withheld_departments} department{demand.withheld_departments === 1 ? " is" : "s are"} below the
          reporting threshold and left out.
        </div>
      ) : null}
    </section>
  );
}
