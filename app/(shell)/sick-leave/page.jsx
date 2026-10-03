import PortfolioScreen from "@/modules/sick-leave/screens/PortfolioScreen";
import { aggregates, meta } from "@/modules/sick-leave/data/sampleData";

export const dynamic = "force-dynamic";

export default function SickLeavePortfolio() {
  return (
    <PortfolioScreen
      aggregates={aggregates}
      meta={meta}
      agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}
