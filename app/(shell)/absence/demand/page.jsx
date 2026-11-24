import DemandScreen from "@/modules/absence/screens/DemandScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";
import { hasDemand } from "@/modules/absence/demand";
import { getPortfolio } from "@/lib/platform/tenantContext";

export const metadata = { title: "Demand and cover | Absence analytics | Welo" };
export const dynamic = "force-dynamic";

/*
  Same permission as the other cohort screens: the demand block is cohort
  level, by department, with suppressed departments already left out by the
  model. A tenant without departments gets the screen's empty state.
*/
export default async function AbsenceDemandPage() {
  const portfolio = await getPortfolio();
  await guard(PERMISSIONS.VIEW_COHORTS);
  return <DemandScreen demand={hasDemand(portfolio) ? portfolio.demand : null} />;
}
