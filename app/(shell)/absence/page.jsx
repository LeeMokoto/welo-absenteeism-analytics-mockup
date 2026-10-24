import AbsencePortfolioScreen from "@/modules/absence/screens/PortfolioScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";

export const metadata = { title: "Absence analytics | Welo" };
export const dynamic = "force-dynamic";

export default async function AbsencePage() {
  await guard(PERMISSIONS.VIEW_COHORTS);

  return <AbsencePortfolioScreen />;
}
