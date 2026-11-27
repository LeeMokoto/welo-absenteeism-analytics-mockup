"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CurrencyAgentNote, Money } from "@/components/platform/Currency";
import { saveDrafts } from "@/modules/control-centre/recommendationStore";
import Markdown from "./Markdown";

const HITL = "Generated from the sample figures on this screen. A human decides the action.";

// The summary path is not a model, and the line under the answer is the last
// place a reader looks before acting on it, so it says which produced this one.
const SUMMARY_HITL =
  "Summarised from the sample figures on this screen by the dashboard, not by a language model. A human decides the action.";

/*
  One reusable agent card. The grounding assembled from the figures on screen
  is sent with every question, so the agent reasons only over what is visible.

  Two ways to supply it, because the two modules render differently. The sick
  leave screens are client components with live state, so they pass
  `getContext`, a function called at the moment the question is asked. The
  absence screens are server components, and a function cannot cross that
  boundary, so they pass `context` as a plain object built on the server. A
  function prop sent from a server component fails at render, not at request
  time, which is a confusing way to find out.

  `endpoint` defaults to the sick leave route so existing call sites are
  unchanged.
*/
export default function AgentPanel({
  agent,
  roleTag,
  description,
  chips,
  getContext,
  context,
  available,
  endpoint = "/api/sick-leave/agent",
  // { question, nonce }: ask this question now, as if typed. Used by a card
  // beside the panel (the Planner's triggers) to put its question to the
  // agent; a new nonce asks again even when the question is the same.
  request = null,
  // () => object: fields sent beside the question, outside the model's
  // grounding (the Reviewer's proposals, which its tools read and the model
  // does not see as text).
  extraBody = null,
  // (outcomes) => void: outcomes the agent drafted, for the screen to offer
  // to a person. The panel only lists them; it records nothing.
  onOutcomes = null,
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  // "model" or "summary". The summary path answers the suggested questions from
  // the figures on screen when no agent key is configured; a buyer has to be
  // able to tell the two apart, so it is tracked rather than inferred.
  const [source, setSource] = useState(null);
  // Set when the model hit its token ceiling. A cut answer is labelled rather
  // than left looking like a rendering fault, which is how it was first
  // reported: the text stops and the box looks like it failed to grow.
  const [truncated, setTruncated] = useState(false);
  // What the agent looked up, and anything it drafted. Shown so a reader can
  // see an answer was built from the platform's figures, and so a draft is
  // never mistaken for something already done.
  const [lookups, setLookups] = useState([]);
  const [drafted, setDrafted] = useState({ saved: [], refused: [] });
  const [outcomes, setOutcomes] = useState([]);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || loading) return;
    setLoading(true);
    setError("");
    setAnswer("");
    setSource(null);
    setTruncated(false);
    setLookups([]);
    setDrafted({ saved: [], refused: [] });
    setOutcomes([]);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent,
          question: text,
          context: getContext ? getContext() : context,
          ...(extraBody ? extraBody() : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "The request failed. Try again in a moment.");
      } else {
        setAnswer(data.text || "");
        setSource(data.source || null);
        setTruncated(Boolean(data.truncated));
        setLookups(Array.isArray(data.tool_calls) ? data.tool_calls : []);
        if (Array.isArray(data.drafts) && data.drafts.length) {
          // Checked again by the store: the drafts crossed the network.
          const { saved, refused } = saveDrafts(data.drafts);
          setDrafted({ saved, refused });
        }
        if (Array.isArray(data.outcomes) && data.outcomes.length) {
          setOutcomes(data.outcomes);
          if (onOutcomes) onOutcomes(data.outcomes);
        }
      }
    } catch {
      setError("Could not reach the agent service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!request?.question) return;
    setQuestion(request.question);
    ask(request.question);
    // Only a new request asks; ask itself changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  return (
    <div className="card">
      <div className="eyebrow">{roleTag}</div>
      <p className="card-note" style={{ marginTop: 8 }}>{description}</p>

      {!available ? (
        <div className="agent-disabled">
          <strong>No agent key configured.</strong> This panel answers the suggested questions
          below from the figures on this screen, by arithmetic rather than by a language model,
          and says so on every answer. A question outside that set is declined rather than
          answered generically. Configure a server-side agent key to ask it anything.
        </div>
      ) : null}

      <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {chips.map((c) => (
              <button key={c} className="chip" onClick={() => { setQuestion(c); ask(c); }} disabled={loading}>
                {c}
              </button>
            ))}
          </div>

          <label className="caption" htmlFor={`q-${agent}`}>ASK A QUESTION</label>
          <textarea
            id={`q-${agent}`}
            className="input"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
            }}
            placeholder="Type a question about the figures on this screen"
            style={{ marginTop: 6 }}
          />
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={() => ask()} disabled={loading || !question.trim()}>
              {loading ? "Thinking" : "Ask"}
            </button>
            <span className="caption">Reasons only over this screen's sample figures.</span>
          </div>
          <CurrencyAgentNote />

          {(answer || error || loading) && (
            <div style={{ marginTop: 14 }}>
              {loading && <div className="agent-response">Working through the figures on this screen.</div>}
              {error && (
                <div className="agent-response" role="alert">
                  <strong>Request did not complete.</strong> {error}
                </div>
              )}
              {answer && (
                <div className="agent-response">
                  <Markdown text={answer} />
                </div>
              )}
              {answer && truncated && (
                <div className="agent-truncated" role="status">
                  This answer reached the model&apos;s token limit and stops short. Ask a
                  narrower question, or raise MAX_TOKENS for this deployment.
                </div>
              )}
              {answer && lookups.length > 0 && (
                <div className="caption" style={{ marginTop: 8 }}>
                  Looked up: {lookups.map((t) => t.tool + (t.ok ? "" : " (refused)")).join(", ")}
                </div>
              )}
              {drafted.saved.length > 0 && (
                <div className="card cream" style={{ marginTop: 10 }}>
                  <div className="caption">Drafted for a decision, not yet approved</div>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {drafted.saved.map((d) => (
                      <li key={d.id} className="card-note" style={{ marginBottom: 4 }}>
                        {d.title}: nets <Money zar={d.predicted.net_rand} /> over {d.predicted.horizon_days} days
                      </li>
                    ))}
                  </ul>
                  <div className="caption" style={{ marginTop: 6 }}>
                    Saved in this browser. <Link href="/control-centre/proposals">Review in Proposals</Link>
                  </div>
                </div>
              )}
              {outcomes.length > 0 && (
                <div className="card cream" style={{ marginTop: 10 }}>
                  <div className="caption">Outcomes drafted for a person to check, not yet recorded</div>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {outcomes.map((o) => (
                      <li key={o.id} className="card-note" style={{ marginBottom: 4 }}>
                        Delivered <Money zar={o.saving_rand} /> against <Money zar={o.predicted_saving_rand} /> predicted
                      </li>
                    ))}
                  </ul>
                  <div className="caption" style={{ marginTop: 6 }}>
                    Filled in on each proposal below, ready to check and record.
                  </div>
                </div>
              )}
              {drafted.refused.length > 0 && (
                <div className="indicative" style={{ marginTop: 8 }}>
                  {drafted.refused.length} draft{drafted.refused.length === 1 ? " was" : "s were"} not saved:{" "}
                  {drafted.refused.map((r) => r.reason).join(" ")}
                </div>
              )}
              {answer && (
                <div className="agent-hitl">
                  {source === "summary" ? SUMMARY_HITL : HITL}
                </div>
              )}
            </div>
          )}
      </>
    </div>
  );
}
