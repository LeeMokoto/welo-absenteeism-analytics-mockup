"use client";

import { caveatClass } from "@/lib/platform/caveat";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionHeader from "@/modules/sick-leave/components/SectionHeader";
import { Money, useCurrency } from "@/components/platform/Currency";
import { decisionBlockers, KINDS, MIN_CLOSED_FOR_TRACK_RECORD, trackRecord } from "../recommendations";
import { applyUpdate, exampleRecommendations, listRecommendations } from "../recommendationStore";

/*
  Proposals.

  Where an agent's priced action meets the person who decides it, and later the
  figure that says whether it delivered. Four choices worth knowing about.

  The track record leads with its own sample size. Below the minimum it says it
  cannot judge yet, before any figure, because a percentage from two cases
  reads as a result.

  A prediction is shown beside what it cost and what it nets. An agent that
  only reported savings would make every action look worth taking.

  The decision rule is shown rather than hidden. The person who asked for a
  draft sees why they cannot approve it, so it reads as a rule rather than a
  missing button.

  Every amount goes through Money, and an outcome typed in dollars is converted
  to Rand before it is sent, because Rand is the unit every record is kept in.
*/

const STATUSES = ["Drafted", "Approved", "Rejected", "Closed"];
const ENDPOINT = "/api/control-centre/recommendations";

function day(iso) {
  return String(iso || "").slice(0, 10);
}

function dueDate(rec) {
  return new Date(new Date(rec.created).getTime() + rec.predicted.horizon_days * 86400000);
}

function tierFor(status) {
  if (status === "Approved" || status === "Closed") return "Low";
  if (status === "Rejected") return "Elevated";
  return "Moderate";
}

export default function ProposalsScreen({
  session,
  canCreate,
  canApprove,
  canAskAgents,
  agentsAvailable,
  dimensions,
  cohorts,
  today,
}) {
  const context = useMemo(() => ({ dimensions, cohorts }), [dimensions, cohorts]);
  // Examples first, so the server render and the first client render match.
  // Whatever this browser holds is read after mount.
  const [recs, setRecs] = useState(() => exampleRecommendations(context));
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setRecs(listRecommendations(context));
  }, [context, revision]);

  const counts = useMemo(() => {
    const c = {};
    for (const r of recs) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [recs]);

  const record = useMemo(() => trackRecord(recs), [recs]);
  const labelFor = useMemo(() => Object.fromEntries((dimensions || []).map((d) => [d.key, d.label])), [dimensions]);

  return (
    <section>
      <SectionHeader title="Proposals" sub="Priced actions an agent drafted, for a person to decide and later check" />

      <div className="grid grid-4">
        {STATUSES.map((s) => (
          <div key={s}>
            <div className="caption">{s}</div>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.03em", marginTop: 2 }}>{counts[s] || 0}</div>
          </div>
        ))}
      </div>

      <div className="indicative long" style={{ marginTop: 10 }}>
        An agent drafts and a person decides. No agent can approve, book or send anything, and the
        person who asked for a draft cannot approve it. Proposals made in this walkthrough are held in
        this browser only; the ones marked as examples ship with the demo.
      </div>

      <div className="section grid grid-2">
        <TrackRecord record={record} />
        <div className="card">
          <div className="card-title">Getting a proposal</div>
          <p className="card-note" style={{ marginBottom: 0 }}>
            {!canAskAgents ? (
              <>Your role can read proposals and not ask the agents for them.</>
            ) : !canCreate ? (
              <>Your role can ask the agents questions, but drafting a proposal needs the create permission.</>
            ) : agentsAvailable ? (
              <>
                Ask the Cover Coordinator on the <Link href="/absence/operations">Operations</Link> screen to
                draft one. It reads the cover figures, prices the action and saves the draft here.
              </>
            ) : (
              <>
                No agent key is configured in this deployment, so the Cover Coordinator answers from built-in
                summaries and cannot draft. The examples below show the full cycle.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="section grid grid-2">
        {recs.map((r) => (
          <ProposalCard
            key={r.id}
            rec={r}
            session={session}
            canApprove={canApprove}
            canCreate={canCreate}
            labelFor={labelFor}
            today={today}
            onUpdated={() => setRevision((n) => n + 1)}
          />
        ))}
      </div>
    </section>
  );
}

function TrackRecord({ record }) {
  return (
    <div className="card">
      <div className="card-title">Track record</div>
      <p className="card-note">{record.summary}</p>
      <table className="data">
        <tbody>
          <tr>
            <td>Closed</td>
            <td style={{ textAlign: "right" }}>
              {record.closed} of {MIN_CLOSED_FOR_TRACK_RECORD} needed
            </td>
          </tr>
          <tr>
            <td>Predicted saving, closed</td>
            <td style={{ textAlign: "right" }}>
              <Money zar={record.predicted_saving_rand} />
            </td>
          </tr>
          <tr>
            <td>Delivered saving, closed</td>
            <td style={{ textAlign: "right" }}>
              <Money zar={record.actual_saving_rand} />
            </td>
          </tr>
          <tr>
            <td>Approved / rejected</td>
            <td style={{ textAlign: "right" }}>
              {record.approved} / {record.rejected}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="indicative long" style={{ marginTop: 10 }}>
        A delivered saving is an observed difference against comparable cohorts, not proof the action
        caused it.
      </div>
    </div>
  );
}

async function send(body) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = Array.isArray(data.errors) && data.errors.length ? ` ${data.errors.join(" ")}` : "";
      return { ok: false, reason: (data.error || "The request failed.") + detail };
    }
    return { ok: true, record: data.recommendation };
  } catch {
    return { ok: false, reason: "Could not reach the server. Check your connection and try again." };
  }
}

function ProposalCard({ rec, session, canApprove, canCreate, labelFor, today, onUpdated }) {
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const kind = KINDS.find((k) => k.key === rec.kind)?.label || rec.kind;
  const blockers = rec.status === "Drafted" ? decisionBlockers(rec, session, { hasApprovePermission: canApprove }) : [];
  const due = dueDate(rec);
  const p = rec.predicted;

  async function act(body) {
    setBusy(true);
    setProblem("");
    const res = await send({ ...body, recommendation: rec });
    if (!res.ok) {
      setProblem(res.reason);
      setBusy(false);
      return;
    }
    const applied = applyUpdate(rec, res.record);
    setBusy(false);
    if (!applied.ok) {
      setProblem(applied.reason);
      return;
    }
    onUpdated();
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div className="card-title">{rec.title}</div>
        <span className={"tier " + tierFor(rec.status)}>{rec.status}</span>
      </div>
      <div className="caption">
        {kind}
        {rec.example ? " · Example" : ""}
      </div>

      <p className="card-note" style={{ marginTop: 8 }}>
        For{" "}
        {rec.target.map((t, i) => (
          <span key={`${t.dimension}-${t.cohort}`}>
            {i ? " and " : ""}
            {labelFor[t.dimension] || t.dimension}: <strong>{t.cohort}</strong>
          </span>
        ))}
        . {rec.rationale}
      </p>

      <table className="data">
        <tbody>
          <tr>
            <td>Predicted saving</td>
            <td style={{ textAlign: "right" }}>
              <Money zar={p.saving_rand} />
            </td>
          </tr>
          <tr>
            <td>Cost of the action</td>
            <td style={{ textAlign: "right" }}>
              <Money zar={p.cost_rand} />
            </td>
          </tr>
          <tr>
            <td>
              <strong>Net, over {p.horizon_days} days</strong>
            </td>
            <td style={{ textAlign: "right" }}>
              <strong>
                <Money zar={p.net_rand} />
              </strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="card-note" style={{ marginTop: 8 }}>How it was priced: {p.basis}</p>

      <div className="caption">
        Drafted by the Cover Coordinator on {day(rec.created)} for {rec.requested_by}.
        {rec.provenance?.length
          ? ` Built from ${rec.provenance.map((t) => t.tool + (t.input?.dimension ? ` (${t.input.dimension})` : "")).join(", ")}.`
          : ""}
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
        {rec.status === "Drafted" ? (
          blockers.length === 0 ? (
            <>
              <div className="caption">Decision</div>
              <textarea
                className="cc-input"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What you decided and why. A rejection needs a reason."
              />
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button className="lens-btn active" disabled={busy} onClick={() => act({ action: "decide", decision: "Approved", note })}>
                  Approve
                </button>
                <button className="lens-btn" disabled={busy} onClick={() => act({ action: "decide", decision: "Rejected", note })}>
                  Reject
                </button>
              </div>
            </>
          ) : (
            <div className="caption">Waiting for a decision. {blockers.join("; ")}.</div>
          )
        ) : (
          <>
            <div className="caption">
              {rec.decision?.decision} on {day(rec.decision?.at)} by the {rec.decision?.role} role
            </div>
            {rec.decision?.note ? (
              <p className="card-note" style={{ marginTop: 6, marginBottom: 0 }}>{rec.decision.note}</p>
            ) : null}
          </>
        )}

        {rec.status === "Approved" ? (
          <Outcome rec={rec} due={due} today={today} canCreate={canCreate} busy={busy} onSend={act} />
        ) : null}

        {rec.status === "Closed" ? <Delivered rec={rec} /> : null}

        {problem ? <div className="indicative" style={{ marginTop: 10 }}>{problem}</div> : null}
      </div>
    </div>
  );
}

function Outcome({ rec, due, today, canCreate, busy, onSend }) {
  const { code, rate, name, note } = useCurrency();
  const [amount, setAmount] = useState("");
  const [basis, setBasis] = useState("");
  const [problem, setProblem] = useState("");

  if (new Date(today) < due) {
    return (
      <div className="caption" style={{ marginTop: 12 }}>
        The outcome can be recorded from {day(due.toISOString())}, when the {rec.predicted.horizon_days}-day
        horizon has passed.
      </div>
    );
  }
  if (!canCreate) {
    return (
      <div className="caption" style={{ marginTop: 12 }}>
        The horizon has passed. Recording the outcome needs the create permission.
      </div>
    );
  }

  function submit() {
    const value = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(value)) {
      setProblem("Enter the delivered saving as a number. A loss is a negative number.");
      return;
    }
    if (!basis.trim()) {
      setProblem("Say how the saving was measured.");
      return;
    }
    setProblem("");
    // Records are kept in Rand. A figure typed in dollars is converted at the
    // rate on screen before it leaves the browser.
    const zar = code === "USD" ? value * (Number(rate?.zarPerUsd) || 0) : value;
    onSend({ action: "close", saving_rand: Math.round(zar), basis });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="caption">Record the outcome</div>
      <input
        className="cc-input"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={`Delivered saving in ${name}`}
      />
      <textarea
        className="cc-input"
        rows={2}
        style={{ marginTop: 8 }}
        value={basis}
        onChange={(e) => setBasis(e.target.value)}
        placeholder="How it was measured, against which comparable cohorts"
      />
      {code === "USD" ? (
        <div className="indicative" style={{ marginTop: 6 }}>
          Entered in US dollars and stored in Rand. {note}
        </div>
      ) : null}
      <button className="lens-btn active" style={{ marginTop: 10 }} disabled={busy} onClick={submit}>
        Record outcome
      </button>
      {problem ? <div className="indicative" style={{ marginTop: 8 }}>{problem}</div> : null}
    </div>
  );
}

function Delivered({ rec }) {
  const ratio = rec.predicted.saving_rand > 0 ? Math.round((rec.actual.saving_rand / rec.predicted.saving_rand) * 100) : null;
  return (
    <div className="card cream" style={{ marginTop: 14 }}>
      <div className="caption">Measured on {day(rec.actual.at)}</div>
      <p className="card-note" style={{ marginTop: 6, marginBottom: 6 }}>
        Predicted <Money zar={rec.predicted.saving_rand} />, delivered <Money zar={rec.actual.saving_rand} />
        {ratio == null ? "." : `, ${ratio}% of the prediction.`} {rec.actual.basis}
      </p>
      <div className="indicative long">An observed difference against comparable cohorts, not proof the action caused it.</div>
    </div>
  );
}
