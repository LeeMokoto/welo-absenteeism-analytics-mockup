import { notFound } from "next/navigation";
import { getManifest } from "@/lib/platform/manifest";
import InterventionsScreen from "@/modules/control-centre/screens/InterventionsScreen";
import { portfolio } from "@/modules/absence/data/portfolio";

export const metadata = { title: "Interventions | Control centre | Welo" };
export const dynamic = "force-dynamic";

/*
  Control centre.

  Reachable only when the tenant manifest enables it, so a tenant that has not
  passed the delta test for the actions store and the outbound task integration
  cannot reach it by typing the URL.

  The cohorts and dimensions come from the same module data the absence screens
  read, which carries aggregates only. That is deliberate: the control centre
  must target cohorts it can see reported, and it must not have a second,
  richer source of its own.
*/
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
          action on specific people, the control centre hands a cohort-level task to the client&apos;s
          own case system, and re-identification happens there.
        </p>
      </header>

      <div style={{ marginTop: 24 }}>
        <InterventionsScreen
          dimensions={portfolio.cohort_dimensions || []}
          cohorts={portfolio.cohorts || {}}
          suppressionThreshold={manifest.suppressionThreshold}
        />
      </div>
    </div>
  );
}
