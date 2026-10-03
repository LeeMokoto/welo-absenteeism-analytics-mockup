"use client";

import dynamic from "next/dynamic";

// Full records and spell history are a large payload, so they download only
// when the clinical case view is opened, not with the rest of the module.
const CaseScreen = dynamic(() => import("@/components/sick-leave/CaseScreen"), {
  ssr: false,
  loading: () => (
    <div className="card">
      <div className="caption">Loading the clinical case view.</div>
    </div>
  ),
});

export default function CaseScreenLoader({ agentsAvailable }) {
  return <CaseScreen agentsAvailable={agentsAvailable} />;
}
