"use client";

import { useState } from "react";
import { pct, num, days, rand, cell } from "@/lib/sick-leave/format";

const COLS = [
  { key: "site", label: "Site", align: "left", type: "text" },
  { key: "shiftPattern", label: "Shift pattern", align: "left", type: "text" },
  { key: "headcount", label: "Headcount", type: "num", render: (r) => num(r.headcount) },
  { key: "ratePct", label: "Sick rate", type: "num", render: (r) => pct(r.ratePct) },
  { key: "meanDaysPerEmployee", label: "Mean days", type: "num", render: (r) => days(r.meanDaysPerEmployee) },
  { key: "certificationRatePct", label: "Cert rate", type: "num", render: (r) => cell(r.certificationRatePct, r.certificationRatePct == null, (v) => pct(v, 0)) },
  { key: "pctAbove75Entitlement", label: ">75% entitlement", type: "num", render: (r) => pct(r.pctAbove75Entitlement, 0) },
  { key: "indicativeCostRand", label: "Indicative cost", type: "num", render: (r) => rand(r.indicativeCostRand) },
];

export default function CohortTable({ rows }) {
  const [sortKey, setSortKey] = useState("ratePct");
  const [dir, setDir] = useState("desc");

  const sorted = [...rows].sort((a, b) => {
    const col = COLS.find((c) => c.key === sortKey);
    let av = a[sortKey];
    let bv = b[sortKey];
    if (col.type === "text") {
      av = String(av); bv = String(bv);
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    av = av ?? -1; bv = bv ?? -1;
    return dir === "asc" ? av - bv : bv - av;
  });

  const onSort = (key) => {
    if (key === sortKey) setDir(dir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setDir(key === "site" || key === "shiftPattern" ? "asc" : "desc"); }
  };

  return (
    <div className="card">
      <div className="card-title">Cohort summary</div>
      <p className="card-note">One row per site and shift pattern. Click a heading to sort.</p>
      <div style={{ overflowX: "auto" }}>
        <table className="data" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key)}
                  style={{ textAlign: c.align === "left" ? "left" : "right" }}
                  aria-sort={sortKey === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  {c.label}
                  {sortKey === c.key ? <span className="sort-caret">{dir === "asc" ? "^" : "v"}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.site}-${r.shiftPattern}`}>
                {COLS.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align === "left" ? "left" : "right", fontVariantNumeric: "tabular-nums" }}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>Rand figures indicative.</div>
    </div>
  );
}
