"use client";

import { useRef, useState } from "react";
import AgentPanel from "@/modules/sick-leave/components/AgentPanel";
import { horizonLabel } from "@/modules/control-centre/recommendations";

/*
  The Planner, with the triggers that say when it is due.

  The triggers (plannerTriggers.js) are worked out on the server from the
  tenant's data and today's date. A fired trigger's question goes to the
  Planner in one click, with the horizon it should draft for. Nothing runs on
  its own: proposals stay in this browser until a shared store is connected,
  so a trigger prompts a person rather than scheduling a run, and the card
  says so.
*/
export default function PlannerSection({ triggers = [], hasThresholds = false, agent }) {
  const [request, setRequest] = useState(null);
  const panel = useRef(null);
  const fired = triggers.filter((t) => t.fired);

  function askAbout(t) {
    setRequest({ question: t.question, nonce: Date.now() });
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <div className="card">
        <div className="card-title" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          When the Planner is due
          <span className={"tier " + (fired.length ? "Elevated" : "Low")}>
            {fired.length ? `${fired.length} due` : "Nothing due"}
          </span>
        </div>
        <p className="card-note">
          Weekly before the roster goes out, monthly for the season view
          {hasThresholds ? ", and whenever the cost forecast runs well above the last year" : ""}. Proposals
          stay in this browser until a shared store is connected, so a trigger prompts you rather than running on
          its own.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>Trigger</th>
              <th>Horizon</th>
              <th style={{ textAlign: "left" }}>Why</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {triggers.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className={"tier " + (t.fired ? "Elevated" : "Low")} style={{ marginRight: 8 }}>
                    {t.fired ? "Due" : "Not yet"}
                  </span>
                  {t.label}
                </td>
                <td>{horizonLabel(t.horizon)}</td>
                <td style={{ whiteSpace: "normal", textAlign: "left" }}>{t.reason}</td>
                <td style={{ textAlign: "right" }}>
                  {t.fired && agent.available ? (
                    <button className="btn" type="button" onClick={() => askAbout(t)}>
                      Ask the Planner
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!hasThresholds ? (
          <p className="caption" style={{ marginTop: 8, marginBottom: 0 }}>
            This tenant has no cost forecast yet, so no threshold can fire.
          </p>
        ) : null}
      </div>

      <div className="section" ref={panel}>
        <AgentPanel {...agent} request={request} />
      </div>
    </>
  );
}
