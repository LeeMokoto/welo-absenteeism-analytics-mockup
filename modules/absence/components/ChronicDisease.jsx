import { pct } from "@/modules/sick-leave/format";
import { CHRONIC_SOURCE, chronic, chronicColumns } from "../data/chronic";
import { suppressionLabel } from "../suppression";

/*
  Chronic disease screening prevalence, cohort by condition.

  Three things make this different from every other panel in the module, and
  each one changes what the component does.

  **The figures are a benchmark, not this tenant's data.** So the provenance is
  on the panel itself, in the chip and in the note, not only in a footnote on
  another screen. A reader who screenshots this card has to carry the caveat
  with the screenshot, because that is how these cards travel.

  **The columns are cohorts, and a cohort can be suppressed.** The values here
  are benchmark figures, so showing one leaks nothing about an individual. The
  column heading does. A cohort withheld everywhere else in the product,
  appearing here under its own name with a health prevalence beside it, both
  contradicts the rest of the interface and states that this employer holds
  health data about a group too small to report on. So the columns are derived
  from the live cohort list and a suppressed cohort is dropped, not greyed: a
  greyed column still names it.

  **It is health data.** Special personal information under POPIA when it is
  real. Nothing here resolves below a cohort, there is no drill path to a
  person, and the panel says so where a reader will actually read it.
*/
export default function ChronicDisease({ cohorts = [], threshold = 5 }) {
  // The control lives in data/chronic.js so it can be tested without
  // rendering a page. This component renders what it returns.
  const { shown, withheld, missing } = chronicColumns(cohorts);

  // The scale spans only the cells actually on screen, so dropping a withheld
  // column cannot change what shade the remaining ones read as relative to a
  // maximum the reader cannot see.
  const values = [];
  for (const r of chronic.rows) for (const c of shown) if (r.byCohort[c.key] != null) values.push(r.byCohort[c.key]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);

  const shade = (v) => {
    const t = max === min ? 0.5 : (v - min) / (max - min);
    // The brand red at variable alpha, the same scale the concentration
    // matrix uses, so two heatmaps in one product read the same way.
    return `rgba(192, 57, 43, ${(0.1 + t * 0.72).toFixed(3)})`;
  };
  const dark = (v) => v > (min + max) / 2;

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div className="card-title">Chronic disease hotspots, cohort by condition</div>
        {/* The chip is the first thing read on a card and the last thing kept
            when one is pasted into a deck, so the provenance goes in it. */}
        <span className="benchmark-tag" style={{ whiteSpace: "nowrap" }}>Benchmark, not measured</span>
      </div>

      <p className="card-note">
        Share of each cohort that would screen positive. These are published benchmarks applied
        to this tenant&apos;s cohort structure, not screening results: nobody in this workforce
        has been screened, and no figure here came from the absence model. They are shown so the
        pattern a screening programme would look for is visible before one runs.
      </p>

      {shown.length === 0 ? (
        <div className="indicative">
          No cohort is large enough to report against. Nothing is shown rather than a grid with
          every column withheld.
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="data" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Condition</th>
                  <th>Group</th>
                  {shown.map((c) => (
                    <th key={c.key} style={{ textAlign: "center" }}>{c.label}</th>
                  ))}
                  <th style={{ textAlign: "center" }}>Workforce</th>
                </tr>
              </thead>
              <tbody>
                {chronic.rows.map((r) => (
                  <tr key={r.condition}>
                    <td style={{ whiteSpace: "normal" }}><strong>{r.condition}</strong></td>
                    <td className="caption">{r.group}</td>
                    {shown.map((c) => {
                      const v = r.byCohort[c.key];
                      return (
                        <td
                          key={c.key}
                          style={{
                            background: v == null ? "transparent" : shade(v),
                            color: v != null && dark(v) ? "#fff" : "var(--ink)",
                            textAlign: "center",
                            fontVariantNumeric: "tabular-nums",
                          }}
                          title={`${r.condition}, ${c.label}: benchmark prevalence`}
                        >
                          {v == null ? "n/a" : pct(v, 0)}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {pct(r.workforce, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="card-note" style={{ marginTop: 14 }}>{chronic.reading}</p>
        </>
      )}

      {/* A dropped column is said out loud. A grid that silently has three
          columns on one screen and two on another is how somebody concludes a
          cohort was deleted. */}
      {withheld.length > 0 ? (
        <div className="indicative" style={{ marginTop: 10 }}>
          {withheld.length === 1 ? "One cohort is" : `${withheld.length} cohorts are`} under{" "}
          {threshold} and carry no column here, the same as everywhere else in this module:{" "}
          {withheld.map((c) => `${c.label} (${suppressionLabel(c.row)})`).join(", ")}.
          The column is dropped rather than greyed, because a greyed column still puts a health
          prevalence beside the name of a group too small to report on.
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="indicative" style={{ marginTop: 10 }}>
          {missing.length} benchmark {missing.length === 1 ? "column has" : "columns have"} no
          matching cohort in the current feed and {missing.length === 1 ? "is" : "are"} not
          shown. The benchmark is keyed to the operational-load cohorts and one has been renamed
          or removed upstream.
        </div>
      ) : null}

      <div className="indicative" style={{ marginTop: 10 }}>
        {CHRONIC_SOURCE} Cohort level only. Nothing here resolves to a person, and there is no
        route from this panel to one.
      </div>
    </div>
  );
}
