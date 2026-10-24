import CohortsScreen from "@/modules/absence/screens/CohortsScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";

export const metadata = { title: "Cohorts | Absence analytics | Welo" };
export const dynamic = "force-dynamic";

export default async function AbsenceCohortsPage() {
  await guard(PERMISSIONS.VIEW_COHORTS);

  return <CohortsScreen />;
}
