"use client";

import { useEffect, useMemo, useState } from "react";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import {
  approvalBlockers,
  horizon as horizonFor,
  outcomeStatement,
  validatePlaybook,
} from "../playbooks";
import { MEASURES } from "../alerts";
import {
  createPlaybook,
  createTask,
  decidePlaybook,
  listInterventions,
  listPlaybooks,
  listTasks,
  seededPlaybooks,
  seeded,
} from "../store";
import { describeTask, dispatchable } from "../tasks";

/*
  Playbooks.

  The screen where an agent draft becomes a plan, or does not. Three things it
  does deliberately.

  It shows the refusal. A draft that proposes a disciplinary step comes back
  with the step and the reason it cannot be filed, attributed to the step rather
  than to the plan, because a drafter who is told only that the plan failed will
  rewrite the wrong part of it. One seeded record is a rejected draft, kept so
  the refusal is visible without anybody having to trigger one.

  It separates drafting from deciding, in the interface as well as the model. A
  drafter sees no approve button on their own plan, and the reason is shown
  rather than the button hidden, so it reads as a rule rather than a bug.

  It never states an outcome as an achievement. The measured record reports an
  observed difference against comparable cohorts and carries the caveat with it,
  because the sentence and the caveat travel together or the caveat gets lost.
*/

export default function PlaybooksScreen({ session, canCreate, canApprove, agentsAvailable }) {
  const [playbooks, setPlaybooks] = useState(() => seededPlaybooks());
  const [interventions, setInterventions] = useState(() => seeded());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setPlaybooks(listPlaybooks());
    setInterventions(listInterventions());
  }, [revision]);

  const byStatus = useMemo(() => {
    const counts = {};
    for (const p of playbooks) counts[p.status] = (counts[p.status] || 0) + 1;
    return counts;
  }, [playbooks]);

  // Interventions with no playbook yet: the list a drafter works from.
  const undrafted = useMemo(
    () => interventions.filter((i) => !playbooks.some((p) => p.intervention_id === i.id)),
    [interventions, playbooks],
  );

  return (
    <section>
      <SectionHeader
        title="Playbooks"
        sub="What will be done about a cohort, drafted by an agent and decided by a person"
      />

      <div className="grid grid-4">
        {["Drafted", "In review", "Approved", "Rejected"].map((s) => (
          <div key={s}>
            <div className="caption">{s}</div>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.03em", marginTop: 2 }}>
              {byStatus[s] || 0}
            </div>
          </div>
        ))}
      </div>

      <div className="indicative" style={{ marginTop: 10 }}>
        The agent proposes and a person decides. Nothing here is a decision taken by the model:
        POPIA section 71 restricts decisions based solely on automated processing, and the
        approver is never the drafter. Playbooks drafted in this walkthrough are held in this
        browser only.
      </div>

      {canCreate ? (
        <Drafting
          interventions={undrafted}
          agentsAvailable={agentsAvailable}
          onSaved={() => setRevision((r) => r + 1)}
        />
      ) : (
        <div className="section">
          <div className="card">
            <div className="card-title">Drafting</div>
            <p className="card-note" style={{ marginBottom: 0 }}>
              Your role can read playbooks and not draft them. Drafting a plan for a cohort needs
              the create permission, and the API refuses a draft without it, so this is not
              simply a hidden button.
            </p>
          </div>
        </div>
      )}

      <div className="section grid grid-2">
        {playbooks.map((p) => (
          <PlaybookCard
            key={p.id}
            playbook={p}
            intervention={interventions.find((i) => i.id === p.intervention_id) || null}
            session={session}
            canApprove={canApprove}
            canCreate={canCreate}
            onDecided={() => setRevision((r) => r + 1)}
          />
        ))}
      </div>
    </section>
  );
}

function Drafting({ interventions, agentsAvailable, onSaved }) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState("");

  const intervention = interventions.find((i) => i.id === selected) || null;

  async function draft() {
    setBusy(true);
    setResult(null);
    setFailure("");
    try {
      const res = await fetch("/api/control-centre/playbooks/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervention }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailure(
          body.error ||
            (res.status === 503
              ? "The agent is not configured in this deployment, so nothing can be drafted."
              : `Drafting was refused (${res.status}).`),
        );
        return;
      }
      setResult(body);
    } catch {
      setFailure("Could not reach the drafting service.");
    } finally {
      setBusy(false);
    }
  }

  function keep() {
    const { persisted } = createPlaybook(result.proposal);
    setResult(null);
    setSelected("");
    if (!persisted) {
      setFailure("Kept for this view only: this browser is not storing it.");
    }
    onSaved();
  }

  return (
    <div className="section">
      <div className="card">
        <div className="card-title">Draft a playbook</div>
        <p className="card-note">
          The agent is given the intervention and the figures for the cohorts it targets, and
          nothing else. It cannot reason about a cohort the record does not name, because it is
          not shown one.
        </p>

        {interventions.length === 0 ? (
          <div className="indicative" style={{ marginTop: 12 }}>
            Every intervention in the register already has a playbook. Create another intervention
            to draft one.
          </div>
        ) : (
          <>
            <div style={{ marginTop: 14 }}>
              <div className="caption">Intervention</div>
              <select
                className="cc-input"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose a record</option>
                {interventions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
              </select>
            </div>

            {!agentsAvailable ? (
              <div className="indicative" style={{ marginTop: 12 }}>
                No agent key is configured here, so the plan will be assembled from a template
                using this cohort&apos;s reported figures. It is held to the same rules as a model
                draft and filed as a template, so the record says how it was produced. The
                approval flow below is the same either way.
              </div>
            ) : null}

            <button
              className="lens-btn active"
              style={{ marginTop: 16 }}
              onClick={draft}
              disabled={!intervention || busy}
            >
              {busy ? "Drafting" : agentsAvailable ? "Draft with the agent" : "Assemble from a template"}
            </button>
          </>
        )}

        {failure ? <div className="indicative" style={{ marginTop: 12 }}>{failure}</div> : null}

        {result ? <Proposal result={result} onKeep={keep} /> : null}
      </div>
    </div>
  );
}

function Proposal({ result, onKeep }) {
  const { proposal, ok, errors } = result;

  return (
    <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--line-soft)" }}>
      <div className="card-title">
        Proposed plan
        {proposal.drafted_with === "template" ? (
          <span className="tier Moderate" style={{ marginLeft: 10, verticalAlign: "middle" }}>
            template
          </span>
        ) : null}
      </div>
      <p className="card-note">
        A proposal, not a decision. It is filed only when somebody with the approver role accepts
        it, and that person cannot be whoever drafted it.
      </p>
      {result.notice ? (
        <div className="indicative" style={{ marginBottom: 12 }}>{result.notice}</div>
      ) : null}

      <Steps steps={proposal.steps} />

      {proposal.why ? (
        <div style={{ marginTop: 14 }}>
          <div className="caption">Why this plan</div>
          <p className="card-note" style={{ marginBottom: 0 }}>{proposal.why}</p>
        </div>
      ) : null}

      {ok ? (
        <>
          <div className="indicative" style={{ marginTop: 14 }}>
            The draft meets the playbook rules. Keeping it files it as Drafted, waiting for a
            decision.
          </div>
          <button className="lens-btn active" style={{ marginTop: 14 }} onClick={onKeep}>
            Keep as a draft
          </button>
        </>
      ) : (
        <div className="card cream" style={{ marginTop: 16 }}>
          <div className="card-title">Refused, and why</div>
          <p className="card-note">
            The agent produced this and the platform will not file it. The reasons name the step,
            so a redraft changes the step that broke a rule rather than the whole plan.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e} className="card-note" style={{ marginBottom: 6 }}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Steps({ steps }) {
  if (!steps?.length) {
    return (
      <div className="indicative" style={{ marginTop: 12 }}>
        The draft contained no steps in the expected shape, so there is nothing to file.
      </div>
    );
  }
  return (
    <table className="data" style={{ marginTop: 12 }}>
      <thead>
        <tr><th>Step</th><th>Owner</th><th>Horizon</th><th>Measure</th></tr>
      </thead>
      <tbody>
        {steps.map((s, i) => (
          <tr key={`${i}-${s.action}`}>
            <td style={{ whiteSpace: "normal" }}>{s.action || <em>missing</em>}</td>
            <td>{s.owner || <em>missing</em>}</td>
            <td>{horizonFor(s.horizon)?.label || s.horizon || <em>missing</em>}</td>
            <td>
              {s.measure
                ? MEASURES.find((m) => m.key === s.measure)?.label || s.measure
                : "not measured"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlaybookCard({ playbook, intervention, session, canApprove, canCreate, onDecided }) {
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");

  const blockers = approvalBlockers(playbook, session, {
    hasApprovePermission: canApprove,
    // A seeded playbook can now be decided as an overlay in this browser, so
    // the only thing the store refuses is a shipped example that already
    // carries its decision. That is already covered by the "already decided"
    // blocker, so there is nothing extra to withhold here.
    storeCanDecide: true,
  });
  const decidable = blockers.length === 0;
  const check = validatePlaybook({ ...playbook, target: undefined }, { intervention });
  const outcome = outcomeStatement(intervention?.outcome);

  function decide(decision) {
    const res = decidePlaybook(playbook.id, {
      decision,
      note,
      by: session?.email,
      byRole: session?.role,
    });
    if (!res.ok) {
      setProblem(res.reason);
      return;
    }
    setProblem("");
    onDecided();
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div className="card-title">{playbook.title}</div>
        <span className={"tier " + tierFor(playbook.status)}>{playbook.status}</span>
      </div>

      <p className="card-note">
        {playbook.drafted_with === "agent"
          ? "Agent drafted"
          : playbook.drafted_with === "template"
          ? "Assembled from a template, no model called"
          : "Written by hand"}{" "}
        on{" "}
        {playbook.drafted_at} by the {playbook.drafted_by_role} role.
        {intervention ? ` Target inherited from "${intervention.title}".` : " Parent record not in this browser."}
      </p>

      <Steps steps={playbook.steps} />

      {playbook.why ? (
        <p className="card-note" style={{ marginTop: 12 }}>{playbook.why}</p>
      ) : null}

      {/* A record that would not pass the rules today says so, rather than
          looking filed and fine. The rejected seeded record is the case. */}
      {!check.ok ? (
        <div className="card cream" style={{ marginTop: 14 }}>
          <div className="caption">Would not be filed today</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {check.errors.map((e) => (
              <li key={e} className="card-note" style={{ marginBottom: 4 }}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {playbook.approval ? (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
          <div className="caption">
            {playbook.approval.decision === "approved" ? "Approved" : "Rejected"} on{" "}
            {playbook.approval.at} by the {playbook.approval.by_role} role
          </div>
          {playbook.approval.note ? (
            <p className="card-note" style={{ marginTop: 6, marginBottom: 0 }}>
              {playbook.approval.note}
            </p>
          ) : null}
        </div>
      ) : (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
          {decidable ? (
            <>
              <div className="caption">Decision</div>
              <textarea
                className="cc-input"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What you decided and why"
              />
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button className="lens-btn active" onClick={() => decide("approved")}>
                  Approve
                </button>
                <button className="lens-btn" onClick={() => decide("rejected")}>
                  Reject
                </button>
              </div>
            </>
          ) : (
            <div className="caption">
              Waiting for a decision. {blockers.join("; ")}.
            </div>
          )}
          {problem ? <div className="indicative" style={{ marginTop: 10 }}>{problem}</div> : null}
        </div>
      )}

      {playbook.status === "Approved" ? (
        <Dispatch
          playbook={playbook}
          intervention={intervention}
          canCreate={canCreate}
          onSent={onDecided}
        />
      ) : null}

      {outcome ? (
        <div className="card cream" style={{ marginTop: 14 }}>
          <div className="caption">Measured</div>
          <p className="card-note" style={{ marginTop: 6, marginBottom: 6 }}>{outcome.text}</p>
          <div className="indicative">{outcome.caveat}</div>
        </div>
      ) : null}
    </div>
  );
}

function tierFor(status) {
  if (status === "Approved") return "Low";
  if (status === "Rejected" || status === "Superseded") return "Elevated";
  return "Moderate";
}

/*
  Sending an approved step to a queue.

  Only rendered for an approved playbook, because that is the gate, and the API
  refuses a step from any other status whatever this screen does. Each step is
  listed with whether it can be sent and why not, rather than filtered: a step
  that cannot be sent is the more interesting row, and an absence tells the
  reader nothing.

  The Approver sees this section and no buttons. Approval permits a task to
  leave; releasing it belongs to the people doing the work, and showing the
  reason is better than showing nothing.
*/
function Dispatch({ playbook, intervention, canCreate, onSent }) {
  const [tasks, setTasks] = useState([]);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    setTasks(listTasks());
  }, [playbook.id]);

  const rows = dispatchable(playbook, { existingTasks: tasks });
  const mine = tasks.filter((t) => t.playbook_id === playbook.id && t.status !== "Cancelled");

  async function send(row) {
    setBusy(row.key);
    setProblem("");
    try {
      const res = await fetch("/api/control-centre/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playbook, step: row.step, intervention, existingTasks: tasks }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblem(body.error || `The task was refused (${res.status}).`);
        return;
      }
      const saved = createTask(body.task);
      if (!saved.ok) {
        setProblem(saved.reason);
        return;
      }
      setTasks(listTasks());
      onSent();
    } catch {
      setProblem("Could not reach the server to authorise this task.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
      <div className="caption">Send to a queue</div>
      <p className="card-note" style={{ marginTop: 6 }}>
        {canCreate
          ? "An approved step can be released to the function that owns it. Nothing leaves this deployment: there is no outbound integration, and the record says so."
          : "Your role approves tasks and does not send them. Approval permits a task to leave; releasing it belongs to the people doing the work."}
      </p>

      <table className="data" style={{ marginTop: 8 }}>
        <thead>
          <tr><th>Step</th><th>Queue</th><th>State</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td style={{ whiteSpace: "normal" }}>{row.step.action}</td>
              <td className="caption">{row.destination_label || "none configured"}</td>
              <td style={{ whiteSpace: "normal" }}>
                {row.existing ? (
                  <span className="caption">Recorded {row.existing.dispatched_at}</span>
                ) : row.ok ? (
                  canCreate ? (
                    <button
                      className="lens-btn"
                      onClick={() => send(row)}
                      disabled={busy === row.key}
                    >
                      {busy === row.key ? "Recording" : "Send"}
                    </button>
                  ) : (
                    <span className="caption">ready</span>
                  )
                ) : (
                  <span className="caption">{row.blockers.join("; ")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {problem ? <div className="indicative" style={{ marginTop: 10 }}>{problem}</div> : null}

      {/* The moment after clicking Send is exactly when somebody could believe
          something was sent, so the confirmation carries the transport note
          rather than leaving it on the record. */}
      {mine.length ? (
        <div style={{ marginTop: 10 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {mine.map((t) => (
              <li key={t.id} className="card-note" style={{ marginBottom: 6 }}>
                {describeTask(t)}
              </li>
            ))}
          </ul>
          <div className="indicative" style={{ marginTop: 8 }}>
            {mine[0].transport_note}
          </div>
        </div>
      ) : null}
    </div>
  );
}
