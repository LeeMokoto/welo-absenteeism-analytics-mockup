import AlertRulesScreen from "@/modules/control-centre/screens/AlertRulesScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";
import { getPortfolio, getTenantManifest } from "@/lib/platform/tenantContext";

export const metadata = { title: "Alert rules | Control centre | Welo" };
export const dynamic = "force-dynamic";

export default async function AlertRulesPage() {
  const portfolio = await getPortfolio();
  await guard(PERMISSIONS.CONTROL_VIEW);

  const manifest = await getTenantManifest();
  return (
    <AlertRulesScreen
      dimensions={portfolio.cohort_dimensions || []}
      cohorts={portfolio.cohorts || {}}
      suppressionThreshold={manifest.suppressionThreshold}
    />
  );
}
