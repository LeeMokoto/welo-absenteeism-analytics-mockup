import { notFound } from "next/navigation";
import ModuleTabs from "@/components/platform/ModuleTabs";
import { getManifest } from "@/lib/platform/manifest";
import controlCentreModule from "@/modules/control-centre/module";

/*
  Control centre layout.

  The gate lives here rather than on each page, so adding a screen cannot
  accidentally add an ungated route. A tenant that has not passed the delta
  test for the actions store and the outbound task integration gets a 404 on
  every screen in the module, including ones written later.
*/
export default function ControlCentreLayout({ children }) {
  const manifest = getManifest();
  if (!manifest.modules.controlCentre) notFound();

  return (
    <div className="page">
      <header style={{ paddingTop: 36, maxWidth: 720 }}>
        <div className="eyebrow">{controlCentreModule.label}</div>
        <h1 style={{ fontSize: 28, marginTop: 10, letterSpacing: "-0.03em" }}>
          Act on cohorts, and see whether it worked
        </h1>
        <p style={{ marginTop: 10, color: "var(--ink-mute)", fontSize: 14.5 }}>
          Every record here refers to a cohort, never to a person. Where an intervention needs
          action on specific people, the control centre hands a cohort-level task to the
          client&apos;s own case system, and re-identification happens there.
        </p>
      </header>

      <ModuleTabs screens={controlCentreModule.screens} />
      <div style={{ marginTop: 24 }}>{children}</div>
    </div>
  );
}
