import PlaybooksScreen from "@/modules/control-centre/screens/PlaybooksScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS, can } from "@/lib/platform/roles";

export const metadata = { title: "Playbooks | Control centre | Welo" };
export const dynamic = "force-dynamic";

/*
  Reading a playbook, drafting one and deciding one are three permissions, and
  this page needs only the first. The drafting API refuses a caller without
  CONTROL_CREATE and the store refuses a decision on a record it does not hold,
  so what is passed down here shapes the interface rather than enforcing it.

  agentsAvailable is read server side so the key never reaches the browser. It
  says whether drafting can work at all, which is worth stating up front rather
  than discovering on a 503.
*/
export default async function PlaybooksPage() {
  const session = await guard(PERMISSIONS.CONTROL_VIEW);

  return (
    <PlaybooksScreen
      session={{ email: session.email, role: session.role, roleLabel: session.roleLabel }}
      canCreate={can(session, PERMISSIONS.CONTROL_CREATE)}
      canApprove={can(session, PERMISSIONS.CONTROL_APPROVE)}
      agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}
