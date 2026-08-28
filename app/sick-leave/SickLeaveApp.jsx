"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import PortfolioScreen from "@/components/sick-leave/PortfolioScreen";
import OpsScreen from "@/components/sick-leave/OpsScreen";
import { aggregates, meta } from "@/lib/sick-leave/sampleData";

// The clinical case view carries the heavy per-record data, so load it lazily:
// its chunk (full records + spell history) only downloads when the tab opens.
const CaseScreen = dynamic(() => import("@/components/sick-leave/CaseScreen"), {
  ssr: false,
  loading: () => (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="caption">Loading the clinical case view.</div>
    </div>
  ),
});

const TABS = [
  { id: "portfolio", label: "Portfolio and cohorts" },
  { id: "case", label: "Case view" },
  { id: "ops", label: "HR and operations" },
];

export default function SickLeaveApp({ agentsAvailable }) {
  const [tab, setTab] = useState("portfolio");

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Sick leave dashboard screens">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        {tab === "portfolio" && (
          <PortfolioScreen aggregates={aggregates} meta={meta} agentsAvailable={agentsAvailable} />
        )}
        {tab === "case" && <CaseScreen agentsAvailable={agentsAvailable} />}
        {tab === "ops" && (
          <OpsScreen aggregates={aggregates} meta={meta} agentsAvailable={agentsAvailable} />
        )}
      </div>
    </div>
  );
}
