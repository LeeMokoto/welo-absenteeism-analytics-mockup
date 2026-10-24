import BriefingScreen from "@/modules/control-centre/screens/BriefingScreen";
import { getManifest } from "@/lib/platform/manifest";
import { portfolio } from "@/modules/absence/data/portfolio";
import { cohortSeries } from "@/modules/control-centre/data/series";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";

export const metadata = { title: "Briefing | Control centre | Welo" };
export const dynamic = "force-dynamic";

/*
  Reading the briefing needs only CONTROL_VIEW. It composes what the other
  screens publish and adds no reach of its own, so anyone who can read those
  can read this.

  asOf is computed on the server so every reader of one render sees the same
  "waiting 51 days", rather than a figure that depends on the clock of the
  browser it happened to open in.
*/
export default async function BriefingPage() {
  await guard(PERMISSIONS.CONTROL_VIEW);

  const manifest = getManifest();
  return (
    <BriefingScreen
      dimensions={portfolio.cohort_dimensions || []}
      cohorts={portfolio.cohorts || {}}
      series={cohortSeries}
      suppressionThreshold={manifest.suppressionThreshold}
      tenant={manifest.tenant}
      asOf={new Date().toISOString().slice(0, 10)}
    />
  );
}
