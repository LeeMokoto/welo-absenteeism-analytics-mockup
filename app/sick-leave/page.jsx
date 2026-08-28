import SampleBanner from "@/components/sick-leave/SampleBanner";
import GovernanceNote from "@/components/sick-leave/GovernanceNote";
import SickLeaveApp from "./SickLeaveApp";
import { meta } from "@/lib/sick-leave/sampleData";
import { num } from "@/lib/sick-leave/format";

// Server component: reads whether the agent key is present (server side only,
// the value never reaches the client) and passes a boolean to the client app.
// The page renders standalone with no environment variable set; only the agent
// panels change, degrading to a clear disabled state.
export const dynamic = "force-dynamic";

export default function SickLeavePage() {
  const agentsAvailable = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <>
      <SampleBanner />
      <main className="page">
        <header style={{ paddingTop: 26 }}>
          <div className="mono" style={{ color: "var(--brown)" }}>WELO HEALTH · SICK LEAVE INTELLIGENCE</div>
          <h1 style={{ fontSize: 28, marginTop: 8 }}>Sick Leave Intelligence</h1>
          <p style={{ marginTop: 8, maxWidth: 720, color: "var(--ink-soft)" }}>
            Statutory sick leave, oriented at care pathways and workforce planning. Synthetic sample
            data for a mining division of {num(meta.cohortSize)} employees across{" "}
            {meta.siteCount} sites. Not used for HR review or disciplinary purposes.
          </p>
        </header>

        <SickLeaveApp agentsAvailable={agentsAvailable} />

        <GovernanceNote />
      </main>
    </>
  );
}
