// Cover gap heatmap: next four weeks across, site and shift pattern down. Cell
// shows projected unfilled backfill shifts. The operational core of the screen.
export default function CoverGapHeatmap({ heatmap }) {
  const allVals = [];
  for (const row of heatmap) for (const v of row.days) allVals.push(v);
  const max = Math.max(...allVals, 1);
  const shade = (v) => (v === 0 ? "var(--cream)" : `rgba(187, 61, 46, ${(0.15 + (v / max) * 0.75).toFixed(3)})`);

  const dayCount = heatmap[0]?.days.length || 28;

  return (
    <div className="card">
      <div className="card-title">Cover gap, next four weeks</div>
      <p className="card-note">
        Projected unfilled backfill shifts per cohort per day. Shift-critical cohorts only.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="data" style={{ minWidth: 900, borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ cursor: "default" }}>Cohort</th>
              {Array.from({ length: dayCount }).map((_, i) => (
                <th key={i} style={{ cursor: "default", padding: "6px 3px", textAlign: "center" }}>
                  {i % 7 === 0 ? `W${i / 7 + 1}` : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.map((row) => (
              <tr key={`${row.site}-${row.shiftPattern}`}>
                <td style={{ whiteSpace: "nowrap" }}>
                  {row.site}
                  <span className="caption" style={{ display: "block" }}>{row.shiftPattern}</span>
                </td>
                {row.days.map((v, i) => (
                  <td
                    key={i}
                    title={`Day ${i + 1}: ${v} shift${v === 1 ? "" : "s"} short`}
                    style={{ background: shade(v), textAlign: "center", padding: "6px 3px", color: v > max * 0.55 ? "#fff" : "var(--ink)", fontVariantNumeric: "tabular-nums" }}
                  >
                    {v || ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>Projected shifts requiring backfill. Modelled, indicative.</div>
    </div>
  );
}
