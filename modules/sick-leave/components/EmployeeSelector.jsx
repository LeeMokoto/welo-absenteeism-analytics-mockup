"use client";

import { useMemo, useState } from "react";

// Records are identified by employeeId only. There is deliberately no name
// field and no search by anything resembling a name.
export default function EmployeeSelector({ index, meta, selectedId, onSelect }) {
  const [site, setSite] = useState("All");
  const [fn, setFn] = useState("All");
  const [tier, setTier] = useState("All");
  const [idQuery, setIdQuery] = useState("");

  const filtered = useMemo(() => {
    return index.filter((r) => {
      if (site !== "All" && r.site !== site) return false;
      if (fn !== "All" && r.function !== fn) return false;
      if (tier !== "All" && r.riskTier !== tier) return false;
      if (idQuery && !r.employeeId.toLowerCase().includes(idQuery.toLowerCase())) return false;
      return true;
    });
  }, [index, site, fn, tier, idQuery]);

  const shown = filtered.slice(0, 60);

  return (
    <div className="card" style={{ position: "sticky", top: 56 }}>
      <div className="card-title">Records</div>
      <p className="card-note">Synthetic records, by id only.</p>

      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <input
          className="input"
          placeholder="Filter by id, e.g. EMP-100"
          value={idQuery}
          onChange={(e) => setIdQuery(e.target.value)}
          aria-label="Filter records by employee id"
        />
        <Select label="Site" value={site} setValue={setSite} options={["All", ...meta.sites]} />
        <Select label="Function" value={fn} setValue={setFn} options={["All", ...meta.functions]} />
        <Select label="Risk tier" value={tier} setValue={setTier} options={["All", "Low", "Moderate", "Elevated"]} />
      </div>

      <div className="caption" style={{ marginBottom: 8 }}>
        {filtered.length} records{filtered.length > shown.length ? `, showing first ${shown.length}` : ""}
      </div>

      <div style={{ display: "grid", gap: 6, maxHeight: 460, overflowY: "auto" }}>
        {shown.map((r) => (
          <button
            key={r.employeeId}
            className="chip"
            onClick={() => onSelect(r.employeeId)}
            aria-pressed={selectedId === r.employeeId}
            style={{
              borderRadius: 6,
              borderColor: selectedId === r.employeeId ? "var(--red)" : "var(--line)",
              background: selectedId === r.employeeId ? "var(--red-faint)" : "var(--card)",
              display: "grid",
              gap: 2,
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.employeeId}</span>
            <span className="caption">{r.site} / {r.function}</span>
            <span className={"tier " + r.riskTier} style={{ justifySelf: "start" }}>{r.riskTier}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Select({ label, value, setValue, options }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span className="caption">{label}</span>
      <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
