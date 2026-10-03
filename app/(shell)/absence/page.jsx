import { getManifest } from "@/lib/platform/manifest";

export const metadata = { title: "Absence analytics | Welo" };

/*
  Absence analytics module.

  The analytics themselves still live in the original static dashboard, which has
  not been ported into the shell yet. Rather than pretend otherwise, this screen
  is an honest front door: it states what the module does, where it currently
  runs, and opens it. Porting the dashboard into module packages is the next
  piece of work, and doing it behind this route means the URL does not change
  when it happens.
*/
export default function AbsencePage() {
  const manifest = getManifest();

  return (
    <div className="page">
      <header style={{ paddingTop: 36, maxWidth: 720 }}>
        <div className="eyebrow">Absence analytics</div>
        <h1 style={{ fontSize: 28, marginTop: 10, letterSpacing: "-0.03em" }}>
          Absence and fatigue
        </h1>
        <p style={{ marginTop: 10, color: "var(--ink-mute)", fontSize: 14.5 }}>
          Predicted absence, fatigue and cost exposure across the covered workforce, with live
          what-if scoring against the trained model and three assistants that reason over the
          figures on screen.
        </p>
      </header>

      <div className="section grid grid-2">
        <div className="card">
          <div className="card-title">Open the dashboard</div>
          <p className="card-note">
            Portfolio, cohorts, outcomes and ROI, and the HR and operations view. Cohorts under{" "}
            {manifest.suppressionThreshold} are suppressed and shown as n&lt;5.
          </p>
          <a className="btn" href="/absenteeism" style={{ textDecoration: "none" }}>
            Open absence analytics
          </a>
        </div>

        <div className="card cream">
          <div className="card-title">Not yet in the shell</div>
          <p className="card-note" style={{ marginBottom: 0 }}>
            This module still runs as the original standalone dashboard and opens outside the
            platform frame. Porting its screens into module packages is planned work; this route
            stays the same when that happens, so links made now keep working.
          </p>
        </div>
      </div>
    </div>
  );
}
