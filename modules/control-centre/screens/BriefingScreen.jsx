"use client";

import { useEffect, useState } from "react";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import { buildBriefing, headline } from "../briefing";
import { listInterventions, listPlaybooks, listTasks, seeded, seededPlaybooks, seededRules } from "../store";
import { describeTask } from "../tasks";
import { exampleRecommendations, listRecommendations } from "../recommendationStore";
import { finishedProposals, measureProposal } from "../review";
import { dateLabel } from "@/modules/absence/staffingCost";
import { Money } from "@/components/platform/Currency";
import AgentPanel from "@/modules/sick-leave/components/AgentPanel";
import { AGENTS } from "@/modules/absence/agentMeta";

// The question the Analyst is asked for the briefing's one written paragraph.
export const BRIEFING_QUESTION = "Write this week's briefing paragraph";

function Range({ r }) {
  if (!r) return <>unknown</>;
  return (
    <>
      <Money zar={r.low} compact /> to <Money zar={r.high} compact />
    </>
  );
}

/*
  What the briefing's paragraph is written from: the briefing itself, cut to
  what a paragraph needs. Cohort and department level, like everything in it.
*/
function paragraphGrounding(data) {
  return {
    briefing: {
      as_of: data.as_of,
      tenant: data.tenant?.name || null,
      headline: headline(data),
      waiting_on_a_person: {
        playbooks: data.decisions.playbooks_awaiting_approval.length,
        proposals: data.decisions.proposals_awaiting_decision.map((p) => ({ title: p.title, horizon: p.horizon, net_rand: p.net_rand })),
        outcomes_to_record: data.decisions.outcomes_awaiting_record,
      },
      risk_ahead: data.risk,
      alert_rules_firing: data.attention.rules_firing.length,
      track_record: data.proposals.track_record,
      caveat: data.proposals.caveat,
    },
  };
}

/*
  The briefing.

  Decisions first, measurements after. A digest that opens with the improvement
  and buries the plans awaiting approval trains people to skim it, so the order
  on this screen is the order of the object and not a layout choice.

  Everything renders from data the other screens already publish. The briefing
  composes; it does not reach into anything richer, which is what keeps it
  unable to say more than the screens do.
*/

export default function BriefingScreen({
  dimensions,
  cohorts,
  series,
  suppressionThreshold,
  tenant,
  asOf,
  now,
  weekOf = null,
  dayRate = null,
  triggers = [],
  staffingCost = null,
  riskByDepartment = [],
  agentsAvailable = false,
  canAskAgents = false,
}) {
  // Proposals and their measurements: the examples on the server render, then
  // this browser's own records once mounted. Measured here with the same
  // fixed code the Reviewer uses, against the series this page was given.
  const proposalsFrom = (recs) => {
    const at = new Date(now || asOf);
    const measurements = finishedProposals(recs, at).map((v) => {
      const m = measureProposal(recs.find((r) => r.id === v.id), { series, cohorts, dayRate, now: at });
      return m.ok ? m : { ok: false, id: v.id, title: v.title, reasons: m.reasons };
    });
    return { proposals: recs, measurements };
  };
  const shared = { dimensions, cohorts, series, suppressionThreshold, asOf, tenant, triggers, staffingCost, riskByDepartment };
  const context = { tenant: tenant?.key, dimensions, cohorts };

  // Seeded data server side so the screen is never empty, then merged with
  // whatever this browser has added.
  const [data, setData] = useState(() =>
    buildBriefing({
      interventions: seeded(),
      playbooks: seededPlaybooks(),
      rules: seededRules(),
      tasks: [],
      ...proposalsFrom(exampleRecommendations(context)),
      ...shared,
    }),
  );

  useEffect(() => {
    setData(
      buildBriefing({
        interventions: listInterventions(),
        playbooks: listPlaybooks(),
        rules: seededRules(),
        tasks: listTasks(),
        ...proposalsFrom(listRecommendations(context)),
        ...shared,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions, cohorts, series, suppressionThreshold, asOf, tenant, triggers, staffingCost, riskByDepartment, dayRate, now]);

  const d = data.decisions;
  const a = data.attention;
  const o = data.outcomes;

  return (
    <section>
      <SectionHeader
        title="Monday briefing"
        sub={`${weekOf ? `The week of ${weekOf}. ` : ""}What needs a person, what is coming, and what the platform recorded. As at ${data.as_of}`}
      />

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

              {d.proposals_awaiting_decision.length ? (
                <table className="data" style={{ marginTop: 10 }}>
                  <thead>
                    <tr><th>Proposal</th><th>Horizon</th><th>Net</th><th>Waiting</th></tr>
                  </thead>
                  <tbody>
                    {d.proposals_awaiting_decision.map((p) => (
                      <tr key={p.id}>
                        <td style={{ whiteSpace: "normal" }}>{p.title}</td>
                        <td>{p.horizon || "unknown"}</td>
                        <td className="cell-mono">{p.net_rand == null ? "unknown" : <Money zar={p.net_rand} compact />}</td>
                        <td>{p.waiting_days == null ? "unknown" : `${p.waiting_days} days`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {d.outcomes_awaiting_record.length ? (
                <table className="data" style={{ marginTop: 10 }}>
                  <thead>
                    <tr><th>Finished, outcome not recorded</th><th>Predicted</th><th>Measured</th><th>Delivered</th></tr>
                  </thead>
                  <tbody>
                    {d.outcomes_awaiting_record.map((o) => (
                      <tr key={o.id}>
                        <td style={{ whiteSpace: "normal" }}>{o.title}</td>
                        {o.reasons ? (
                          <td colSpan={3} className="caption" style={{ whiteSpace: "normal" }}>
                            Cannot be measured: {o.reasons.join("; ")}.
                          </td>
                        ) : (
                          <>
                            <td className="cell-mono"><Money zar={o.predicted_saving_rand} compact /></td>
                            <td className="cell-mono"><Range r={o.measured_saving_rand} /></td>
                            <td>
                              {o.delivered_share == null ? "unknown" : `${Math.round(o.delivered_share * 100)}%`}
                              {o.shortfall_rand > 0 ? (
                                <span className="caption"> (short by <Money zar={o.shortfall_rand} compact />)</span>
                              ) : null}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {data.proposals.caveat ? (
                <div className="caption" style={{ marginTop: 6 }}>{data.proposals.caveat}</div>
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

      {/* --- Risk ahead --- */}
      <div className="section card">
        <div className="card-title">Risk ahead</div>
        {data.risk.triggers_fired.length === 0 && !data.risk.value_at_risk_90d ? (
          <p className="card-note" style={{ marginBottom: 0 }}>
            No planning trigger is due and this tenant has no cost forecast yet.
          </p>
        ) : (
          <>
            {data.risk.value_at_risk_90d ? (
              <p className="card-note">
                <strong>
                  <Range r={data.risk.value_at_risk_90d} />
                </strong>{" "}
                at risk from {dateLabel(data.risk.from)} to {dateLabel(data.risk.to)}.
              </p>
            ) : null}
            {data.risk.triggers_fired.length ? (
              <table className="data">
                <thead>
                  <tr><th>Planning trigger due</th><th>Horizon</th><th style={{ textAlign: "left" }}>Why</th></tr>
                </thead>
                <tbody>
                  {data.risk.triggers_fired.map((t) => (
                    <tr key={t.label}>
                      <td>{t.label}</td>
                      <td>{t.horizon}</td>
                      <td style={{ whiteSpace: "normal", textAlign: "left" }}>{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {data.risk.by_department.length ? (
              <table className="data" style={{ marginTop: 10 }}>
                <thead>
                  <tr><th>Department</th><th>At risk, next 90 days</th></tr>
                </thead>
                <tbody>
                  {data.risk.by_department.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="cell-mono"><Range r={r.value_at_risk_rand} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {data.risk.note ? <div className="caption" style={{ marginTop: 6 }}>{data.risk.note}</div> : null}
          </>
        )}
      </div>

      {/* --- The one written paragraph --- */}
      {canAskAgents ? (
        <div className="section">
          <AgentPanel
            agent={AGENTS.analyst.id}
            roleTag="BRIEFING PARAGRAPH"
            description="One paragraph for the top of the briefing, written by the Analyst from the figures on this screen. Labelled as written by an agent; check it before forwarding."
            chips={[BRIEFING_QUESTION]}
            available={agentsAvailable}
            context={paragraphGrounding(data)}
            endpoint="/api/absence/agent"
          />
        </div>
      ) : null}

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
              <tr><td>Proposals running</td><td>{data.proposals.running}</td></tr>
              <tr><td>Proposals closed</td><td>{data.proposals.track_record.closed}</td></tr>
            </tbody>
          </table>
          <div className="caption" style={{ marginTop: 6 }}>{data.proposals.track_record.summary}</div>
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
