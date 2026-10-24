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
  decidePlaybook,
  listInterventions,
  listPlaybooks,
  seededPlaybooks,
  seeded,
} from "../store";

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
                The agent is not configured in this deployment, so drafting will report that
                rather than inventing a plan.
              </div>
            ) : null}

            <button
              className="lens-btn active"
              style={{ marginTop: 16 }}
              onClick={draft}
              disabled={!intervention || busy}
            >
              {busy ? "Drafting" : "Draft with the agent"}
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
      <div className="card-title">Proposed plan</div>
      <p className="card-note">
        A proposal, not a decision. It is filed only when somebody with the approver role accepts
        it, and that person cannot be whoever drafted it.
      </p>

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

function PlaybookCard({ playbook, intervention, session, canApprove, onDecided }) {
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");

  const blockers = approvalBlockers(playbook, session, {
    hasApprovePermission: canApprove,
    // The mocked store can only record a decision on a playbook drafted in
    // this browser, so a button is not offered for one it would refuse.
    storeCanDecide: playbook.source !== "seeded",
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
        {playbook.drafted_with === "agent" ? "Agent drafted" : "Written by hand"} on{" "}
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
