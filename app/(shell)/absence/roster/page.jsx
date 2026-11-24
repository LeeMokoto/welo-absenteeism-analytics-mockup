import RosterScreen from "@/modules/absence/screens/RosterScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";
import { rosterGroups } from "@/modules/absence/sampleRoster";
import { getPortfolio } from "@/lib/platform/tenantContext";

export const metadata = { title: "Roster check | Absence analytics | Welo" };
export const dynamic = "force-dynamic";

/*
  The groupings come from the server's module data; the example roster is
  generated from them in the browser, and an uploaded roster is read in the
  browser too. Nothing about a roster is sent to the server.
*/
export default async function AbsenceRosterPage() {
  const portfolio = await getPortfolio();
  await guard(PERMISSIONS.VIEW_COHORTS);
  return <RosterScreen groups={rosterGroups(portfolio)} />;
}
