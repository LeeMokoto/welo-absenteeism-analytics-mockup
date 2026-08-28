"use client";

import { useState } from "react";
import Markdown from "./Markdown";

const HITL = "Generated from the sample figures on this screen. A human decides the action.";

// One reusable agent card for all three agents. `getContext` returns the
// compact grounding object assembled from the figures on screen; it is sent
// with every question so the agent reasons only over what is visible.
export default function AgentPanel({ agent, roleTag, description, chips, getContext, available }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || loading) return;
    setLoading(true);
    setError("");
    setAnswer("");
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
      }
    } catch {
      setError("Could not reach the agent service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="mono" style={{ color: "var(--brick-deep)" }}>{roleTag}</div>
      <p className="card-note" style={{ marginTop: 8 }}>{description}</p>

      {!available ? (
        <div className="agent-disabled">
          <strong>Agent offline.</strong> This panel is disabled because no Anthropic API
          key is configured on the server. The rest of the dashboard works normally.
          Configure the server-side Anthropic key to enable the assistant.
        </div>
      ) : (
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
              {answer && <div className="agent-hitl">{HITL}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
