import CaseScreenLoader from "./CaseScreenLoader";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS } from "@/lib/platform/roles";

export const dynamic = "force-dynamic";

// The clinical case view. Its per-record data is heavy, so the screen itself is
// loaded on the client only when this route is opened.
export default async function SickLeaveCase() {
  await guard(PERMISSIONS.VIEW_CASE);

  return <CaseScreenLoader agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)} />;
}
