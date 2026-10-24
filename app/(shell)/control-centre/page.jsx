import { getManifest } from "@/lib/platform/manifest";
import InterventionsScreen from "@/modules/control-centre/screens/InterventionsScreen";
import { portfolio } from "@/modules/absence/data/portfolio";

export const metadata = { title: "Interventions | Control centre | Welo" };
export const dynamic = "force-dynamic";

/*
  The cohorts and dimensions come from the same module data the absence screens
  read, which carries aggregates only. Deliberate: the control centre must
  target cohorts it can see reported, and must not have a second, richer source
  of its own. The module gate is in the layout.
*/
export default function InterventionsPage() {
  const manifest = getManifest();
  return (
    <InterventionsScreen
      dimensions={portfolio.cohort_dimensions || []}
      cohorts={portfolio.cohorts || {}}
      suppressionThreshold={manifest.suppressionThreshold}
    />
  );
}
