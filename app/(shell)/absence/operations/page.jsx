import AbsenceOpsScreen from "@/modules/absence/screens/OpsScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";
import { getPortfolio } from "@/lib/platform/tenantContext";

export const metadata = { title: "HR and operations | Absence analytics | Welo" };
export const dynamic = "force-dynamic";

export default async function AbsenceOperationsPage() {
  await guard(PERMISSIONS.VIEW_COHORTS);
  const portfolio = await getPortfolio();

  return <AbsenceOpsScreen portfolio={portfolio} agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)} />;
}
