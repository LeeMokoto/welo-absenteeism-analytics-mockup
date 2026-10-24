import AbsenceOutcomesScreen from "@/modules/absence/screens/OutcomesScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";

export const metadata = { title: "Outcomes and ROI | Absence analytics | Welo" };
export const dynamic = "force-dynamic";

export default async function AbsenceOutcomesPage() {
  await guard(PERMISSIONS.VIEW_COHORTS);

  return <AbsenceOutcomesScreen />;
}
