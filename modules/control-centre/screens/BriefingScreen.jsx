"use client";

import { useEffect, useState } from "react";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import { buildBriefing, headline } from "../briefing";
import { listInterventions, listPlaybooks, listTasks, seeded, seededPlaybooks, seededRules } from "../store";
import { describeTask } from "../tasks";

/*
  The briefing.

  Decisions first, measurements after. A digest that opens with the improvement
  and buries the plans awaiting approval trains people to skim it, so the order
  on this screen is the order of the object and not a layout choice.

  Everything renders from data the other screens already publish. The briefing
  composes; it does not reach into anything richer, which is what keeps it
  unable to say more than the screens do.
*/

export default function BriefingScreen({ dimensions, cohorts, series, suppressionThreshold, tenant, asOf }) {
  // Seeded data server side so the screen is never empty, then merged with
  // whatever this browser has added.
  const [data, setData] = useState(() =>
    buildBriefing({
      interventions: seeded(),
      playbooks: seededPlaybooks(),
      rules: seededRules(),
      tasks: [],
      dimensions,
      cohorts,
      series,
      suppressionThreshold,
      asOf,
      tenant,
    }),
  );

  useEffect(() => {
    setData(
      buildBriefing({
        interventions: listInterventions(),
        playbooks: listPlaybooks(),
        rules: seededRules(),
        tasks: listTasks(),
        dimensions,
        cohorts,
        series,
        suppressionThreshold,
        asOf,
        tenant,
      }),
    );
  }, [dimensions, cohorts, series, suppressionThreshold, asOf, tenant]);

  const d = data.decisions;
  const a = data.attention;
  const o = data.outcomes;

  return (
    <section>
      <SectionHeader title="Briefing" sub={`What needs a person, and what the platform recorded. As at ${data.as_of}`} />

      <div className="card cream">
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>{headline(data)}</div>
        <p className="card-note" style={{ marginBottom: 0, marginTop: 8 }}>
          {data.footer.not_a_decision}
        </p>
      </div>

      {/* --- Decisions, first --- */}
      <div className="section">
        <div className="card">
          <div className="card-title">Waiting on a person</div>
          {d.count === 0 ? (
            <p className="card-note" style={{ marginBottom: 0 }}>
              Nothing is waiting on a decision. Said plainly rather than replaced with something
              more cheerful.
            </p>
          ) : (
            <>
              {d.playbooks_awaiting_approval.length ? (
                <table className="data" style={{ marginTop: 10 }}>
                  <thead>
                    <tr><th>Playbook</th><th>Drafted</th><th>Waiting</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {d.playbooks_awaiting_approval.map((p) => (
                      <tr key={p.id}>
                        <td style={{ whiteSpace: "normal" }}>{p.title}</td>
                        <td>{p.drafted_at}</td>
                        <td>{p.waiting_days == null ? "unknown" : `${p.waiting_days} days`}</td>
                        <td style={{ whiteSpace: "normal" }} className="caption">{p.note || "needs an approver"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {d.approved_steps_not_yet_sent.length ? (
                <div className="indicative" style={{ marginTop: 12 }}>
                  {d.approved_steps_not_yet_sent.length} approved step
                  {d.approved_steps_not_yet_sent.length === 1 ? " has" : "s have"} not been sent to a
                  queue yet. An approved plan nobody released is a decision that changed nothing.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* --- What the rules noticed --- */}
      <div className="section grid grid-2">
        <div className="card">
          <div className="card-title">Alert rules</div>
          {a.rules_firing.length === 0 ? (
            <p className="card-note">No rule is firing on the current figures.</p>
          ) : (
            <table className="data">
              <thead><tr><th>Rule</th><th>Cohort</th><th>Value</th></tr></thead>
              <tbody>
                {a.rules_firing.map((f, i) => (
                  <tr key={`${f.rule}-${f.cohort}-${i}`}>
                    <td style={{ whiteSpace: "normal" }}>{f.rule}</td>
                    <td>{f.cohort}</td>
                    <td>{typeof f.value === "number" ? Math.round(f.value * 100) / 100 : "unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {a.skipped_note ? (
            <div className="indicative" style={{ marginTop: 10 }}>{a.skipped_note}</div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-title">Activity</div>
          <table className="data">
            <tbody>
              {Object.entries(data.activity.interventions_by_status).map(([status, n]) => (
                <tr key={status}><td>{status}</td><td>{n}</td></tr>
              ))}
              <tr><td>Playbooks</td><td>{data.activity.playbooks_total}</td></tr>
              <tr><td>Tasks recorded</td><td>{data.activity.tasks_recorded}</td></tr>
            </tbody>
          </table>
          {data.activity.tasks_note ? (
            <div className="indicative" style={{ marginTop: 10 }}>{data.activity.tasks_note}</div>
          ) : null}
        </div>
      </div>

      {/* --- Outcomes, after the decisions --- */}
      <div className="section">
        <div className="card">
          <div className="card-title">What has been measured</div>
          {o.measured.length === 0 ? (
            <p className="card-note">Nothing is measurable yet.</p>
          ) : (
            o.measured.map((m) => (
              <div key={m.id} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
                <div className="caption">{m.title}</div>
                <div style={{ fontSize: 14.5, marginTop: 6 }}>{m.raw}</div>
                <div style={{ fontSize: 13, color: "var(--ink-mute)", marginTop: 6 }}>{m.context}</div>
                {m.headline ? (
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 8 }}>{m.headline}</div>
                ) : null}
                {/* Carried in full. A briefing is forwarded and pasted, so the
                    caveat travels inside it. */}
                <div className="indicative" style={{ marginTop: 8 }}>{m.caveat}</div>
                <div className="caption" style={{ marginTop: 6 }}>{m.provenance}</div>
              </div>
            ))
          )}

          {o.not_yet_measurable.length ? (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
              <div className="caption">Not measurable yet, and why</div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {o.not_yet_measurable.map((n) => (
                  <li key={n.id} className="card-note" style={{ marginBottom: 6 }}>
                    <strong>{n.title}.</strong> {n.reasons.join("; ")}.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {/* --- Tasks --- */}
      {data.activity.tasks_recorded > 0 ? (
        <div className="section">
          <div className="card">
            <div className="card-title">Tasks recorded</div>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {listTasks()
                .filter((t) => t.status !== "Cancelled")
                .map((t) => (
                  <li key={t.id} className="card-note" style={{ marginBottom: 8 }}>
                    {describeTask(t)}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="section">
        <div className="indicative">{data.footer.level}</div>
      </div>
    </section>
  );
}
