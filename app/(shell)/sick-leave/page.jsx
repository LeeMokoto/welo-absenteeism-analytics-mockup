import PortfolioScreen from "@/modules/sick-leave/screens/PortfolioScreen";
import { aggregates, meta } from "@/modules/sick-leave/data/sampleData";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";

export const dynamic = "force-dynamic";

export default async function SickLeavePortfolio() {
  await guard(PERMISSIONS.VIEW_COHORTS);

  return (
    <PortfolioScreen
      aggregates={aggregates}
      meta={meta}
      agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}
