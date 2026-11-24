import AbsencePortfolioScreen from "@/modules/absence/screens/PortfolioScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";
import { getPortfolio } from "@/lib/platform/tenantContext";

export const metadata = { title: "Absence analytics | Welo" };
export const dynamic = "force-dynamic";

export default async function AbsencePage() {
  await guard(PERMISSIONS.VIEW_COHORTS);
  const portfolio = await getPortfolio();

  // Read server side so the key never reaches the browser; the panel only
  // uses it to decide whether to show the no-key notice.
  return <AbsencePortfolioScreen portfolio={portfolio} agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)} />;
}
