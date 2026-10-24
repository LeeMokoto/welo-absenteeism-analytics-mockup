import { getManifest } from "@/lib/platform/manifest";
import InterventionsScreen from "@/modules/control-centre/screens/InterventionsScreen";
import { portfolio } from "@/modules/absence/data/portfolio";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS, can } from "@/lib/platform/roles";

export const metadata = { title: "Interventions | Control centre | Welo" };
export const dynamic = "force-dynamic";

/*
  The cohorts and dimensions come from the same module data the absence screens
  read, which carries aggregates only. Deliberate: the control centre must
  target cohorts it can see reported, and must not have a second, richer source
  of its own. The module gate is in the layout.
*/
export default async function InterventionsPage() {
  // Reading the register and adding to it are different permissions. The page
  // needs the first; the create form needs the second, and the API refuses a
  // write without it, so hiding the button is a courtesy rather than the
  // control.
  const session = await guard(PERMISSIONS.CONTROL_VIEW);

  const manifest = getManifest();
  return (
    <InterventionsScreen
      dimensions={portfolio.cohort_dimensions || []}
      cohorts={portfolio.cohorts || {}}
      suppressionThreshold={manifest.suppressionThreshold}
      canCreate={can(session, PERMISSIONS.CONTROL_CREATE)}
    />
  );
}
