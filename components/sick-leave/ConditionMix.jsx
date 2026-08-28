import { pct } from "@/lib/sick-leave/format";

// Horizontal bars by ICD-10 chapter: share of days versus share of spells.
// The interesting cut, since musculoskeletal and mental health drive long
// spells while respiratory drives spell count. Chapter level only, n<5
// suppressed.
export default function ConditionMix({ mix }) {
  const maxDays = Math.max(...mix.map((m) => m.shareDaysPct || 0), 1);
  const maxSpells = Math.max(...mix.map((m) => m.shareSpellsPct || 0), 1);

  return (
    <div className="card">
      <div className="card-title">Condition mix by ICD-10 chapter</div>
      <p className="card-note">
        Share of days (brick) against share of spells (brown). Chapter level only. Special
        personal information is never resolved below chapter here.
      </p>

      <div style={{ display: "grid", gap: 10 }}>
        {mix.map((m) => (
          <div key={m.chapter} style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, alignItems: "center" }}>
            <span className="caption" style={{ whiteSpace: "normal" }}>{m.chapter}</span>
            {m.suppressed ? (
              <span className="nlt5">n&lt;5, suppressed</span>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                <BarRow value={m.shareDaysPct} max={maxDays} soft={false} label={`${pct(m.shareDaysPct)} days`} />
                <BarRow value={m.shareSpellsPct} max={maxSpells} soft label={`${pct(m.shareSpellsPct)} spells`} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BarRow({ value, max, soft, label }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8, alignItems: "center" }}>
      <div className="bar-track" style={{ height: 12 }}>
        <div className={"bar-fill" + (soft ? " soft" : "")} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="caption" style={{ textAlign: "right" }}>{label}</span>
    </div>
  );
}
