import { getManifest } from "@/lib/platform/manifest";
import AlertRulesScreen from "@/modules/control-centre/screens/AlertRulesScreen";
import { portfolio } from "@/modules/absence/data/portfolio";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";

export const metadata = { title: "Alert rules | Control centre | Welo" };
export const dynamic = "force-dynamic";

export default async function AlertRulesPage() {
  await guard(PERMISSIONS.CONTROL_VIEW);

  const manifest = getManifest();
  return (
    <AlertRulesScreen
      dimensions={portfolio.cohort_dimensions || []}
      cohorts={portfolio.cohorts || {}}
      suppressionThreshold={manifest.suppressionThreshold}
    />
  );
}
