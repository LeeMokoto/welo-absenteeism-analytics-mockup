"use client";

import { useMemo, useState } from "react";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import { pct } from "@/modules/sick-leave/format";
import { checkRoster, parseRosterCsv } from "../roster";
import { rosterToCsv, sampleRoster } from "../sampleRoster";

/*
  Roster check.

  Where fatigue is designed into a roster before anyone is tired. The same
  rules for everyone on it, counted by department: legal rest minimums first,
  fatigue policy second, because they carry different weight.

  The example roster is generated in the browser from the tenant's own
  groupings. A roster the visitor loads is read in the browser too and never
  sent anywhere, which the screen says, since a roster is operational data
  about real people even when it carries only anonymised references.
*/

function ShareCell({ rule }) {
  if (!rule) return <td style={{ textAlign: "right" }}>·</td>;
  const share = rule.staff_share;
  const strong = share >= 0.25;
  return (
    <td style={{ textAlign: "right", fontWeight: strong ? 600 : 400, color: strong ? "var(--red-deep)" : undefined }}>
      {pct(share * 100, 0)}
    </td>
  );
}

export default function RosterScreen({ groups }) {
  const example = useMemo(() => sampleRoster(groups || []), [groups]);
  const [loaded, setLoaded] = useState(null);
  const [problems, setProblems] = useState([]);

  const shifts = loaded ? loaded.shifts : example;
  const result = useMemo(() => checkRoster(shifts), [shifts]);
  const legal = result.rules.filter((r) => r.kind === "legal");
  const fatigue = result.rules.filter((r) => r.kind === "fatigue");
  const departments = result.by_department;

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseRosterCsv(String(reader.result || ""));
      if (parsed.refused || !parsed.shifts.length) {
        setProblems(parsed.errors.length ? parsed.errors : ["No shifts could be read from that file."]);
        return;
      }
      setProblems(parsed.errors);
      setLoaded({ name: file.name, shifts: parsed.shifts });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function downloadExample() {
    const blob = new Blob([rosterToCsv(example)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "example-roster.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <SectionHeader title="Roster check" sub="Rest and fatigue rules, applied to everyone on the roster" />

      <div className="indicative">
        {loaded
          ? `Checking ${loaded.name}. It was read in this browser and has not been sent anywhere.`
          : "Checking an example roster generated for this demo: four weeks, synthetic staff references. Load your own to check it instead; it is read in this browser and not sent anywhere."}
      </div>

      <div className="section" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label className="lens-btn" style={{ cursor: "pointer" }}>
          Load a roster (CSV)
          <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
        </label>
        {loaded ? (
          <button className="lens-btn" onClick={() => { setLoaded(null); setProblems([]); }}>
            Back to the example
          </button>
        ) : (
          <button className="lens-btn" onClick={downloadExample}>Download the example as CSV</button>
        )}
        <span className="caption">Columns: staff_ref, department, start, end, and optionally published_at, changed_at</span>
      </div>

      {problems.length ? (
        <div className="indicative" style={{ marginBottom: 12 }}>
          {problems.slice(0, 5).join(" ")}
          {problems.length > 5 ? ` And ${problems.length - 5} more.` : ""}
        </div>
      ) : null}

      <div className="grid grid-4" style={{ marginTop: 6 }}>
        <div>
          <div className="caption">People on the roster</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{result.total.staff}</div>
        </div>
        <div>
          <div className="caption">Shifts checked</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{result.total.shifts}</div>
        </div>
        <div>
          <div className="caption">People with a daily-rest breach</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{pct(result.total.rules.daily_rest.staff_share * 100, 0)}</div>
        </div>
        <div>
          <div className="caption">People with a late close then early open</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{pct(result.total.rules.late_then_early.staff_share * 100, 0)}</div>
        </div>
      </div>

      {[["Legal minimums", legal], ["Fatigue policy", fatigue]].map(([title, rules]) => (
        <div className="section" key={title}>
          <div className="card">
            <div className="card-title">{title}</div>
            <p className="card-note">
              Share of each department's people with at least one shift breaking the rule over the roster period.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Department</th>
                    {rules.map((r) => (
                      <th key={r.key} style={{ textAlign: "right" }} title={r.description}>{r.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) =>
                    d.suppressed ? (
                      <tr key={d.label}>
                        <td>{d.label}</td>
                        <td colSpan={rules.length} className="caption">
                          Fewer than {d.suppressed_below} people on the roster, so no figures are shown.
                        </td>
                      </tr>
                    ) : (
                      <tr key={d.label}>
                        <td>{d.label}</td>
                        {rules.map((r) => <ShareCell key={r.key} rule={d.rules[r.key]} />)}
                      </tr>
                    ),
                  )}
                  <tr>
                    <td><strong>All reportable departments</strong></td>
                    {rules.map((r) => <ShareCell key={r.key} rule={result.total.rules[r.key]} />)}
                  </tr>
                </tbody>
              </table>
            </div>
            <ul className="card-note" style={{ marginTop: 10, paddingLeft: 18 }}>
              {rules.map((r) => (
                <li key={r.key}>
                  <strong>{r.label}.</strong> {r.description} <span className="caption">{r.source}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}

      <div className="indicative">{result.note}</div>
    </section>
  );
}
