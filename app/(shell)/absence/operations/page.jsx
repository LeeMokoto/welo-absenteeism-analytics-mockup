import AbsenceOpsScreen from "@/modules/absence/screens/OpsScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";

export const metadata = { title: "HR and operations | Absence analytics | Welo" };
export const dynamic = "force-dynamic";

export default async function AbsenceOperationsPage() {
  await guard(PERMISSIONS.VIEW_COHORTS);

  return <AbsenceOpsScreen />;
}
