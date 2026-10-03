import { notFound } from "next/navigation";
import { getManifest } from "@/lib/platform/manifest";

export const metadata = { title: "Control centre | Welo" };
export const dynamic = "force-dynamic";

/*
  Control centre, next phase.

  Reachable only when the tenant manifest enables it, so a tenant that has not
  passed the delta test for the actions store and the outbound task integration
  cannot reach it by typing the URL. The screen is a declared outline of the six
  capabilities, not a mock of them: showing empty furniture as though it worked
  would be the wrong thing to put in front of a client.
*/
const CAPABILITIES = [
  ["Interventions register", "Each intervention names the cohort it targets, an owner, a due date and a status."],
  ["Alert rules", "Thresholds on cohort measures raise an alert before anyone thinks to look."],
  ["Playbooks", "Recommended actions per pattern, with the assistant drafting a plan for a person to approve."],
  ["Outcome tracking", "Each intervention measured against comparable cohorts over the same fixed periods."],
  ["Briefings", "Scheduled summaries for leadership, carrying the same suppression and stamps as every other view."],
  ["Outbound tasks", "A declared, cohort-level integration that creates tasks in the client's own systems."],
];

export default function ControlCentrePage() {
  const manifest = getManifest();
  if (!manifest.modules.controlCentre) notFound();

  return (
    <div className="page">
      <header style={{ paddingTop: 36, maxWidth: 720 }}>
        <div className="eyebrow">Control centre</div>
        <h1 style={{ fontSize: 28, marginTop: 10, letterSpacing: "-0.03em" }}>
          Act on cohorts, and see whether it worked
        </h1>
        <p style={{ marginTop: 10, color: "var(--ink-mute)", fontSize: 14.5 }}>
          Every record here refers to a cohort, never to a person. Where an intervention needs
          action on specific people, the control centre hands a cohort-level task to the client's
          own case system, and re-identification happens there.
        </p>
      </header>

      <div className="section grid grid-2">
        {CAPABILITIES.map(([title, body]) => (
          <div key={title} className="card">
            <div className="card-title">{title}</div>
            <p className="card-note" style={{ marginBottom: 0 }}>{body}</p>
            <div className="indicative" style={{ marginTop: 14 }}>Not built yet</div>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="card cream">
          <div className="card-title">Outcome claims</div>
          <p className="card-note" style={{ marginBottom: 0 }}>
            Outcome tracking reports an observed difference between a target cohort and its
            comparators. It is not proof that the intervention caused the difference, and the
            interface says so wherever a result is shown.
          </p>
        </div>
      </div>
    </div>
  );
}
