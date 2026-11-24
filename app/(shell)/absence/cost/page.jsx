import StaffingCostScreen from "@/modules/absence/screens/StaffingCostScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";
import { portfolio } from "@/modules/absence/data/portfolio";
import { hasStaffingCost } from "@/modules/absence/staffingCost";

export const metadata = { title: "Cost of short staffing | Absence analytics | Welo" };
export const dynamic = "force-dynamic";

/*
  Same permission as the other cohort screens: the block is counted by month,
  department and service, built from shifts with no person in them. A tenant
  without departments that earn revenue by service gets the screen's empty
  state.
*/
export default async function AbsenceStaffingCostPage() {
  await guard(PERMISSIONS.VIEW_COHORTS);
  return <StaffingCostScreen block={hasStaffingCost(portfolio) ? portfolio.staffing_cost : null} />;
}
