"use client";

import { useMemo, useState } from "react";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import { num } from "@/modules/sick-leave/format";
import {
  COMPARISONS,
  MEASURES,
  describeRule,
  evaluateAll,
  formatThreshold,
  formatValue,
  measure as findMeasure,
  validateRule,
} from "../alerts";
import { targetableDimensions, untargetableReason } from "../targeting";
import { seededRules } from "../store";

/*
  Alert rules.

  Two things worth knowing about this screen before reading it.

  It shows what each rule is doing right now, not just what it would do. A rule
  list that cannot be evaluated against current figures is a list of
  intentions, and the usual way a rule goes wrong is that it fires on
  everything or on nothing and nobody notices for a quarter.

  It shows what each rule could not evaluate. A rule written across a whole
  dimension meets suppressed cohorts when it runs, and those are skipped
  because a sub-threshold cohort must not be named in an alert. Reporting the
  skips is the difference between "nothing is wrong" and "I could not see half
  of it".
*/

export default function AlertRulesScreen({ dimensions, cohorts, suppressionThreshold }) {
  const [rules, setRules] = useState(() => seededRules());
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState([]);

  const context = { dimensions, cohorts, suppressionThreshold };
  const evaluated = useMemo(() => evaluateAll(rules, context), [rules, cohorts, suppressionThreshold]);

  const firingCount = evaluated.reduce((a, e) => a + e.result.firing.length, 0);
  const skippedCount = evaluated.reduce((a, e) => a + e.result.skipped.length, 0);
  const targetable = targetableDimensions(dimensions);

  function save() {
    const check = validateRule(draft, context);
    setErrors(check.errors);
    if (!check.ok) return;
    setRules((prev) => [...prev, { ...draft, id: `rule-local-${Date.now().toString(36)}`, source: "local", enabled: true }]);
    setDraft(null);
  }

  return (
    <section>
      <SectionHeader title="Alert rules" sub="Notice a change before somebody thinks to look" />

      <div className="grid grid-3">
        <Stat label="Rules" value={num(rules.length)} />
        <Stat label="Firing now" value={num(firingCount)} />
        <Stat label="Cohorts not evaluated" value={num(skippedCount)} />
      </div>
      <div className="indicative" style={{ marginTop: 10 }}>
        Evaluated against the current feed. A rule never names a cohort under the threshold, so a
        rule across a whole dimension will skip the cohorts it cannot report on, and says how many.
      </div>

      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div className="card-title">Rules</div>
          <button
            className="lens-btn"
            onClick={() =>
              setDraft(
                draft
                  ? null
                  : { name: "", measure: MEASURES[0].key, comparison: "above", threshold: "", scope: { dimension: "" }, owner: "" }
              )
            }
          >
            {draft ? "Cancel" : "New rule"}
          </button>
        </div>

        {draft ? (
          <NewRule
            draft={draft}
            setDraft={setDraft}
            targetable={targetable}
            cohorts={cohorts}
            dimensions={dimensions}
            errors={errors}
            onSave={save}
          />
        ) : null}

        <div className="section" style={{ display: "grid", gap: 16 }}>
          {evaluated.map(({ rule, result }) => (
            <RuleCard key={rule.id} rule={rule} result={result} dimensions={dimensions} />
          ))}
        </div>
      </div>

      <div className="section">
        <div className="card cream">
          <div className="card-title">What a rule may watch</div>
          <p className="card-note">
            Rates and averages, never counts. A rule on a count fires because a cohort is large
            rather than because it is unwell, and it points the response at the wrong group.
          </p>
          <table className="data">
            <thead><tr><th>Measure</th><th>What it is</th></tr></thead>
            <tbody>
              {MEASURES.map((m) => (
                <tr key={m.key}>
                  <td><strong>{m.label}</strong></td>
                  <td style={{ whiteSpace: "normal" }} className="caption">{m.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="indicative" style={{ marginTop: 10 }}>
            A rule is scoped with the same rules as an intervention target: never a protected
            attribute, never condition data.
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="caption">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.03em", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function RuleCard({ rule, result, dimensions }) {
  const m = findMeasure(rule.measure);
  const firing = result.firing.length > 0;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div>
          <div className="card-title">{rule.name}</div>
          <div className="caption" style={{ marginTop: 2 }}>Owner: {rule.owner || "unassigned"}</div>
        </div>
        <span className={"tier " + (firing ? "Elevated" : "Low")}>
          {firing ? `${result.firing.length} firing` : "quiet"}
        </span>
      </div>

      <p className="card-note" style={{ marginTop: 8 }}>{describeRule(rule, dimensions)}</p>

      {firing ? (
        <table className="data" style={{ marginTop: 12 }}>
          <thead><tr><th>Cohort</th><th>Covered</th><th>{m?.label}</th><th>Threshold</th></tr></thead>
          <tbody>
            {result.firing.map((f) => (
              <tr key={f.cohort}>
                <td><strong>{f.cohort}</strong></td>
                <td>{num(f.count)}</td>
                <td>{formatValue(f.value, m)}</td>
                <td className="caption">{formatThreshold(rule.threshold, m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="indicative" style={{ marginTop: 12 }}>
          Nothing above the threshold in {result.quiet.length} evaluated{" "}
          {result.quiet.length === 1 ? "cohort" : "cohorts"}.
        </div>
      )}

      {result.skipped.length ? (
        <div className="indicative" style={{ marginTop: 10 }}>
          {result.skipped.length} not evaluated:{" "}
          {result.skipped.map((s) => `${s.cohort} (${s.reason})`).join("; ")}.
        </div>
      ) : null}

      {rule.source === "local" ? (
        <div className="indicative" style={{ marginTop: 10 }}>Held in this browser only.</div>
      ) : null}
    </div>
  );
}

function NewRule({ draft, setDraft, targetable, cohorts, dimensions, errors, onSave }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  const m = findMeasure(draft.measure);
  const blocked = (dimensions || [])
    .map((d) => ({ d, reason: untargetableReason(d) }))
    .filter((x) => x.reason);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">New rule</div>
      <p className="card-note">
        Scoped with the same rules as an intervention target. A rule that fires on an age band is
        a recurring statement that an age group is a problem, which is worse than a one-off report.
      </p>

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <div>
          <div className="caption">Name</div>
          <input className="cc-input" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Appears in the alert" />
        </div>
        <div>
          <div className="caption">Owner</div>
          <input className="cc-input" value={draft.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="Who acts on it" />
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 14 }}>
        <div>
          <div className="caption">Measure</div>
          <select className="cc-input" value={draft.measure} onChange={(e) => set({ measure: e.target.value })}>
            {MEASURES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
        <div>
          <div className="caption">Comparison</div>
          <select className="cc-input" value={draft.comparison} onChange={(e) => set({ comparison: e.target.value })}>
            {COMPARISONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <div className="caption">Threshold{m?.unit === "share" ? " (0 to 1)" : ""}</div>
          <input className="cc-input" value={draft.threshold} onChange={(e) => set({ threshold: e.target.value })} placeholder={m?.unit === "share" ? "0.2" : "12"} />
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <div>
          <div className="caption">Dimension</div>
          <select
            className="cc-input"
            value={draft.scope.dimension}
            onChange={(e) => set({ scope: { dimension: e.target.value } })}
          >
            <option value="">Choose a dimension</option>
            {targetable.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <div className="caption">Cohort, or every cohort</div>
          <select
            className="cc-input"
            value={draft.scope.cohort || ""}
            onChange={(e) => set({ scope: { ...draft.scope, cohort: e.target.value || undefined } })}
            disabled={!draft.scope.dimension}
          >
            <option value="">Every cohort in the dimension</option>
            {((cohorts || {})[draft.scope.dimension] || [])
              .filter((c) => !c.suppressed)
              .map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {blocked.length ? (
        <div className="indicative" style={{ marginTop: 14 }}>
          Not available: {blocked.map(({ d, reason }) => `${d.label} (${reason})`).join("; ")}.
        </div>
      ) : null}

      {errors.length ? (
        <div className="card cream" style={{ marginTop: 14 }}>
          <div className="card-title">This cannot be saved</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {errors.map((e) => <li key={e} className="card-note" style={{ marginBottom: 4 }}>{e}</li>)}
          </ul>
        </div>
      ) : null}

      <button className="lens-btn active" style={{ marginTop: 16 }} onClick={onSave}>Save rule</button>
    </div>
  );
}
