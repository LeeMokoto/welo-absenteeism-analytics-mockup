"use client";

import { useState } from "react";
import Markdown from "./Markdown";

const HITL = "Generated from the sample figures on this screen. A human decides the action.";

// The summary path is not a model, and the line under the answer is the last
// place a reader looks before acting on it, so it says which produced this one.
const SUMMARY_HITL =
  "Summarised from the sample figures on this screen by the dashboard, not by a language model. A human decides the action.";

// One reusable agent card for all three agents. `getContext` returns the
// compact grounding object assembled from the figures on screen; it is sent
// with every question so the agent reasons only over what is visible.
export default function AgentPanel({ agent, roleTag, description, chips, getContext, available }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  // "model" or "summary". The summary path answers the suggested questions from
  // the figures on screen when no agent key is configured; a buyer has to be
  // able to tell the two apart, so it is tracked rather than inferred.
  const [source, setSource] = useState(null);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || loading) return;
    setLoading(true);
    setError("");
    setAnswer("");
    setSource(null);
    try {
      const res = await fetch("/api/sick-leave/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, question: text, context: getContext() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "The request failed. Try again in a moment.");
      } else {
        setAnswer(data.text || "");
        setSource(data.source || null);
      }
    } catch {
      setError("Could not reach the agent service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

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
