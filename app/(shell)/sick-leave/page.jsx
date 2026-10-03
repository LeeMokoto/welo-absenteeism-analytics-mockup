import PortfolioScreen from "@/components/sick-leave/PortfolioScreen";
import { aggregates, meta } from "@/lib/sick-leave/sampleData";

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
