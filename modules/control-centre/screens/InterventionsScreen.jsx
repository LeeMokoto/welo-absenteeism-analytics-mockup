"use client";

import { useEffect, useMemo, useState } from "react";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import { num } from "@/modules/sick-leave/format";
import {
  MAX_TARGET_DIMENSIONS,
  canSaveIntervention,
  targetableDimensions,
  untargetableReason,
} from "../targeting";
import {
  STATUSES,
  createIntervention,
  listInterventions,
  seeded,
} from "../store";

/*
  Interventions register.

  The spine of the control centre: what was decided, for which cohort, by whom,
  and whether it worked. Everything else hangs off this.

  Two things this screen does that a register normally would not. It refuses a
  target at the point of save rather than warning about it, because the record
  is the thing that persists and a warning that can be clicked past is not a
  control. And it shows the dimensions you cannot target alongside the ones you
  can, with the reason, because a user who cannot find age will otherwise
  assume a bug rather than a decision.
*/

export default function InterventionsScreen({
  dimensions,
  cohorts,
  suppressionThreshold,
  canCreate = false,
}) {
  // Seeded records render on the server so the screen is never empty; records
  // from this browser are merged after mount, which is also why the list is
  // keyed off a counter rather than recomputed inline.
  const [records, setRecords] = useState(() => seeded());
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setRecords(listInterventions());
  }, [revision]);

  const targetable = useMemo(
    () => targetableDimensions(dimensions),
    [dimensions]
  );
  const blocked = useMemo(
    () =>
      (dimensions || [])
        .map((d) => ({ dimension: d, reason: untargetableReason(d) }))
        .filter((x) => x.reason),
    [dimensions]
  );

  const byStatus = STATUSES.map((s) => ({
    status: s,
    count: records.filter((r) => r.status === s).length,
  })).filter((x) => x.count);

  return (
    <section>
      <SectionHeader
        title="Interventions"
        sub="What was decided, for which cohort, and whether it worked"
      />

      <div className="grid grid-4">
        {byStatus.map(({ status, count }) => (
          <div key={status}>
            <div className="caption">{status}</div>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.03em", marginTop: 2 }}>
              {count}
            </div>
          </div>
        ))}
      </div>

      <div className="indicative" style={{ marginTop: 10 }}>
        The actions store is mocked in this tenant. Records you create are held in this browser
        only: they survive navigation, and they are gone for the next visitor. Nothing here is
        filed anywhere.
      </div>

      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div className="card-title">Register</div>
          {canCreate ? (
            <button className="lens-btn" onClick={() => setCreating((v) => !v)}>
              {creating ? "Cancel" : "New intervention"}
            </button>
          ) : (
            <span className="caption">
              Your role can read the register and not add to it
            </span>
          )}
        </div>

        {canCreate && creating ? (
          <NewIntervention
            dimensions={dimensions}
            targetable={targetable}
            cohorts={cohorts}
            suppressionThreshold={suppressionThreshold}
            onSaved={() => {
              setCreating(false);
              setRevision((r) => r + 1);
            }}
          />
        ) : null}

        <div className="section grid grid-2">
          {records.map((r) => (
            <InterventionCard key={r.id} record={r} dimensions={dimensions} />
          ))}
        </div>
      </div>

      <div className="section">
        <div className="card cream">
          <div className="card-title">Why some dimensions are missing</div>
          <p className="card-note">
            Targeting is held to stricter rules than reporting, because an intervention record is
            a durable statement that a group was singled out. At most {MAX_TARGET_DIMENSIONS}{" "}
            dimensions, and never one of these.
          </p>
          <table className="data">
            <thead>
              <tr><th>Dimension</th><th>Reportable</th><th>Targetable</th><th>Why not</th></tr>
            </thead>
            <tbody>
              {blocked.map(({ dimension, reason }) => (
                <tr key={dimension.key}>
                  <td><strong>{dimension.label}</strong></td>
                  <td>yes</td>
                  <td>no</td>
                  <td style={{ whiteSpace: "normal" }} className="caption">{reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="indicative" style={{ marginTop: 10 }}>
            Age is reported at a higher minimum cohort size than the other dimensions, and is not
            available for targeting at any size.
          </div>
        </div>
      </div>
    </section>
  );
}

function InterventionCard({ record, dimensions }) {
  const label = (key) => (dimensions || []).find((d) => d.key === key)?.label || key;
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div className="card-title">{record.title}</div>
        <span className={"tier " + tierFor(record.status)}>{record.status}</span>
      </div>

      <p className="card-note" style={{ marginTop: 8 }}>{record.rationale}</p>

      <table className="data" style={{ marginTop: 12 }}>
        <tbody>
          <tr>
            <td>Target</td>
            <td style={{ whiteSpace: "normal" }}>
              {record.target.map((t) => `${label(t.dimension)}: ${t.cohort}`).join(" and ")}
            </td>
          </tr>
          <tr>
            <td>Covered</td>
            <td>{record.headcount == null ? "not established" : num(record.headcount)}</td>
          </tr>
          <tr><td>Owner</td><td>{record.owner}</td></tr>
          <tr><td>Raised</td><td>{record.created}</td></tr>
          <tr><td>Due</td><td>{record.due || "not set"}</td></tr>
        </tbody>
      </table>

      {record.outcome?.measured ? (
        <div style={{ marginTop: 14 }}>
          <div className="caption">
            Observed against {record.outcome.comparators.join(" and ")}
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4 }}>
            {record.outcome.baseline_days_per_head} to {record.outcome.observed_days_per_head} days
            per head
          </div>
          <div className="indicative" style={{ marginTop: 8 }}>{record.outcome.note}</div>
        </div>
      ) : (
        <div className="indicative" style={{ marginTop: 14 }}>
          No outcome yet. Measurement starts once the intervention has run a full period.
        </div>
      )}

      {record.source === "local" ? (
        <div className="indicative" style={{ marginTop: 10 }}>
          Held in this browser only.
        </div>
      ) : null}
    </div>
  );
}

function tierFor(status) {
  if (status === "Closed") return "Low";
  if (status === "Measuring" || status === "Running") return "Moderate";
  return "Elevated";
}

function NewIntervention({ dimensions, targetable, cohorts, suppressionThreshold, onSaved }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [rationale, setRationale] = useState("");
  const [picks, setPicks] = useState([{ dimension: "", cohort: "" }]);
  const [errors, setErrors] = useState([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const selections = picks.filter((p) => p.dimension && p.cohort);
  const check = canSaveIntervention(selections, {
    dimensions,
    cohorts,
    suppressionThreshold,
  });

  const setPick = (i, patch) =>
    setPicks((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  /*
    Saving goes through the API before it touches browser storage. The checks
    below run here too, so a user sees a problem without a round trip, but the
    decision that matters is the server's: the role check and the target
    validation both execute there, so a client that skips this form is refused
    rather than trusted. The store stays browser-local either way.
  */
  async function save() {
    const problems = [...check.errors];
    if (!title.trim()) problems.push("An intervention needs a title.");
    if (!owner.trim()) problems.push("An intervention needs a named owner.");
    setErrors(problems);
    if (problems.length) return;

    setSaving(true);
    try {
      const res = await fetch("/api/control-centre/interventions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          record: {
            title: title.trim(),
            owner: owner.trim(),
            rationale: rationale.trim(),
            target: selections,
            due: null,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(body.errors || [body.error || `The record was refused (${res.status}).`]);
        return;
      }

      const { persisted } = createIntervention(body.record);
      setNotice(
        persisted
          ? ""
          : "Saved for this view only: this browser is not storing it, so it will not survive a reload."
      );
      onSaved();
    } catch {
      setErrors(["Could not reach the server to authorise this record."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">New intervention</div>
      <p className="card-note">
        The target is checked when you save, not when you type. A target that breaks the rules
        cannot be filed.
      </p>

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <Field label="Title" value={title} onChange={setTitle} placeholder="Rostering review for ..." />
        <Field label="Owner" value={owner} onChange={setOwner} placeholder="Who is accountable" />
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="caption">Rationale</div>
        <textarea
          className="cc-input"
          rows={2}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Why this cohort, and what will be done"
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="caption">
          Target, at most {MAX_TARGET_DIMENSIONS} dimensions
        </div>
        {picks.map((pick, i) => (
          <div key={i} className="grid grid-2" style={{ marginTop: 8 }}>
            <select
              className="cc-input"
              value={pick.dimension}
              onChange={(e) => setPick(i, { dimension: e.target.value, cohort: "" })}
            >
              <option value="">Choose a dimension</option>
              {targetable.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
            <select
              className="cc-input"
              value={pick.cohort}
              onChange={(e) => setPick(i, { cohort: e.target.value })}
              disabled={!pick.dimension}
            >
              <option value="">Choose a cohort</option>
              {((cohorts || {})[pick.dimension] || [])
                .filter((c) => !c.suppressed)
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label} ({num(c.count)})
                  </option>
                ))}
            </select>
          </div>
        ))}
        {picks.length < MAX_TARGET_DIMENSIONS ? (
          <button
            className="lens-btn"
            style={{ marginTop: 10 }}
            onClick={() => setPicks((p) => [...p, { dimension: "", cohort: "" }])}
          >
            Add a second dimension
          </button>
        ) : null}
      </div>

      {check.needsConfirmation ? (
        <div className="indicative" style={{ marginTop: 14 }}>
          Two dimensions intersect to a headcount the feed does not carry, so it is recorded as not
          established rather than estimated. The intersection is no larger than the smaller cohort
          and may fall under the threshold.
        </div>
      ) : null}

      {errors.length ? (
        <div className="card cream" style={{ marginTop: 14 }}>
          <div className="card-title">This cannot be saved</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e} className="card-note" style={{ marginBottom: 4 }}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {notice ? <div className="indicative" style={{ marginTop: 12 }}>{notice}</div> : null}

      <button
        className="lens-btn active"
        style={{ marginTop: 16 }}
        onClick={save}
        disabled={saving}
      >
        {saving ? "Authorising" : "Save intervention"}
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <div className="caption">{label}</div>
      <input
        className="cc-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
