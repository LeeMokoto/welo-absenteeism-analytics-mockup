import { num } from "@/lib/sick-leave/format";

export default function EntitlementBurn({ burn, cohortSize }) {
  const bands = burn.bands;
  const max = Math.max(...bands.map((b) => b.count), 1);
  const proj = burn.projection;

  return (
    <div className="card">
      <div className="card-title">Entitlement burn, current 36 month cycle</div>
      <p className="card-note">
        A workforce planning and care signal. Entitlement exhaustion predicts unpaid absence and
        financial strain on the employee, and is used here to plan cover and route support.
      </p>

      <div style={{ display: "grid", gap: 8 }}>
        {bands.map((b) => (
          <div key={b.band} style={{ display: "grid", gridTemplateColumns: "120px 1fr 64px", gap: 10, alignItems: "center" }}>
            <span className="caption">{b.band}</span>
            <div className="bar-track">
              <div
                className={"bar-fill" + (b.band === "Exhausted" ? "" : " soft")}
                style={{ width: `${(b.count / max) * 100}%` }}
              />
            </div>
            <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(b.count)}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        <div className="caption" style={{ marginBottom: 8 }}>
          Forecast to exhaust entitlement, at current burn
        </div>
        <div className="grid grid-3">
          {[
            ["Next 3 months", proj.in3Months],
            ["Next 6 months", proj.in6Months],
            ["Next 12 months", proj.in12Months],
          ].map(([label, v]) => (
            <div key={label} style={{ background: "var(--cream)", border: "1px solid var(--line)", borderRadius: 6, padding: "10px 12px" }}>
              <div className="caption">{label}</div>
              <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, marginTop: 4 }}>{num(v)}</div>
              <div className="caption">employees</div>
            </div>
          ))}
        </div>
      </div>
      <div className="indicative" style={{ marginTop: 12 }}>
        Cohort of {num(cohortSize)}. Planning signal, not a behavioural measure.
      </div>
    </div>
  );
}
