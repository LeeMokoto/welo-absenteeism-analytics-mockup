"use client";

import { num, days } from "@/lib/sick-leave/format";

const DRIVER_PATHWAY = {
  "Chronic condition management": "Medical aid chronic programme",
  "Musculoskeletal strain": "Occupational health, physiotherapy referral",
  "Respiratory recurrence": "On-site clinic, occupational health",
  "Fatigue and shift load": "Occupational health, shift review with the employee",
  "Mental health": "Employee assistance programme",
  "Commute and travel burden": "Employee assistance programme, transport support",
  "Certification gap": "On-site clinic, help completing certification",
  "Post-injury recovery": "Occupational health, structured return to work",
};

function tenureBand(months) {
  if (months < 12) return "Under 1 year";
  if (months < 36) return "1 to 3 years";
  if (months < 84) return "3 to 7 years";
  if (months < 180) return "7 to 15 years";
  return "15 years or more";
}

function addMonthsIso(iso, months) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function CaseRecord({ record, events }) {
  const cycleEnd = addMonthsIso(record.cycleStartDate, 36);
  const maxSpell = Math.max(...events.map((e) => e.days), 1);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Identity strip */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 18 }}>{record.employeeId}</div>
          <span className={"tier " + record.riskTier}>{record.riskTier}</span>
        </div>
        <div className="grid grid-4" style={{ marginTop: 12 }}>
          <Field label="Site" value={record.site} />
          <Field label="Function" value={record.function} />
          <Field label="Shift pattern" value={record.shiftPattern} />
          <Field label="Tenure" value={tenureBand(record.tenureMonths)} />
          <Field label="Age band" value={record.ageBand} />
        </div>
      </div>

      {/* Entitlement position: neutral planning context, ink only, no warning. */}
      <div className="card">
        <div className="card-title">Entitlement position</div>
        <p className="card-note">Planning context. Not a warning, and not a measure of this person.</p>
        <div className="grid grid-4">
          <Field label="Days consumed" value={days(record.daysConsumed)} />
          <Field label="Days remaining" value={days(record.daysRemaining)} />
          <Field label="Cycle ends" value={cycleEnd} />
          <Field label="Projected exhaustion" value={record.projectedExhaustionDate || "Not projected"} />
        </div>
      </div>

      {/* Absence history: chapter detail is appropriate here, the viewer is clinical. */}
      <div className="card">
        <div className="card-title">Absence history, current cycle</div>
        <p className="card-note">Spells over the cycle. Chapter level, shown because this view is clinical.</p>
        {events.length === 0 ? (
          <div className="caption">No recorded spells in the current cycle.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {events.map((e) => (
              <div key={e.eventId} style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 12, alignItems: "center" }}>
                <span className="caption">{e.startDate}</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                  <div className="bar-track" style={{ height: 14 }}>
                    <div className={"bar-fill" + (e.paid ? "" : " soft")} style={{ width: `${(e.days / maxSpell) * 100}%` }} />
                  </div>
                  <span className="caption" style={{ whiteSpace: "nowrap" }}>
                    {days(e.days)}d, {e.paid ? "paid" : "unpaid"}, {e.certified ? "certified" : "no cert"}, {e.icd10Chapter}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Model output: MODELLED, explainable drivers. */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="card-title">Model output</div>
          <span className="modelled-tag">MODELLED</span>
        </div>
        <p className="card-note">
          Risk score {record.riskScore.toFixed(2)}, tier {record.riskTier}. Every driver below carries
          the plain-language basis it is derived from.
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {record.drivers.map((d) => (
            <div key={d.label} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>{d.label}</strong>
                <span className="caption">contribution {Math.round(d.contribution * 100)}%</span>
              </div>
              <div className="bar-track" style={{ height: 8, marginTop: 6 }}>
                <div className="bar-fill" style={{ width: `${d.contribution * 100}%` }} />
              </div>
              <p className="caption" style={{ marginTop: 6, whiteSpace: "normal" }}>{d.derivation}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Care pathway panel. */}
      <div className="card cream">
        <div className="card-title">Care pathways</div>
        <p className="card-note">Where each driver maps in the employer's existing provision.</p>
        <div style={{ display: "grid", gap: 8 }}>
          {record.drivers.map((d) => (
            <div key={d.label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <span>{d.label}</span>
              <span className="caption" style={{ whiteSpace: "normal" }}>{DRIVER_PATHWAY[d.label] || "Occupational health"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="caption">{label}</div>
      <div style={{ marginTop: 2 }}>{value}</div>
    </div>
  );
}
