import { pct } from "@/lib/sick-leave/format";

// Site by function grid. Cell value is sick leave rate, colour scale on brick.
// Cells under five employees show n<5.
export default function ConcentrationMatrix({ concentration, functions }) {
  const rates = [];
  for (const row of concentration) for (const c of row.cells) if (!c.suppressed && c.ratePct != null) rates.push(c.ratePct);
  const max = Math.max(...rates, 1);
  const min = Math.min(...rates, 0);

  const shade = (rate) => {
    const t = max === min ? 0.5 : (rate - min) / (max - min);
    // brick with variable alpha
    return `rgba(187, 61, 46, ${(0.12 + t * 0.72).toFixed(3)})`;
  };

  return (
    <div className="card">
      <div className="card-title">Concentration, site by function</div>
      <p className="card-note">Cell is sick leave rate. Cells under five employees are suppressed.</p>
      <div style={{ overflowX: "auto" }}>
        <table className="data" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Site</th>
              {functions.map((f) => (
                <th key={f} style={{ cursor: "default" }}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {concentration.map((row) => (
              <tr key={row.site}>
                <td>{row.site}</td>
                {row.cells.map((c) => (
                  <td
                    key={c.function}
                    style={{
                      background: c.suppressed ? "transparent" : shade(c.ratePct),
                      color: !c.suppressed && c.ratePct > (min + max) / 2 ? "#fff" : "var(--ink)",
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                    }}
                    title={c.suppressed ? "Suppressed, under five employees" : `${c.headcount} employees`}
                  >
                    {c.suppressed ? <span className="nlt5">n&lt;5</span> : pct(c.ratePct)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>Sick leave rate, percent of scheduled days.</div>
    </div>
  );
}
