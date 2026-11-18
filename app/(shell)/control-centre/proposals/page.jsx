import ProposalsScreen from "@/modules/control-centre/screens/ProposalsScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS, can } from "@/lib/platform/roles";
import { portfolio } from "@/modules/absence/data/portfolio";

export const metadata = { title: "Proposals | Control centre | Welo" };
export const dynamic = "force-dynamic";

/*
  Reading proposals needs CONTROL_VIEW. Deciding one needs CONTROL_APPROVE and
  recording its outcome needs CONTROL_CREATE; the route refuses both without
  them, so what is passed down here shapes the interface rather than enforcing
  it.

  `today` is taken on the server, so whether an outcome can be recorded yet does
  not depend on the clock of whichever browser opened the page. The route checks
  the horizon again with its own clock when the outcome is sent.
*/
export default async function ProposalsPage() {
  const session = await guard(PERMISSIONS.CONTROL_VIEW);

  return (
    <ProposalsScreen
      session={{ email: session.email, role: session.role, roleLabel: session.roleLabel }}
      canCreate={can(session, PERMISSIONS.CONTROL_CREATE)}
      canApprove={can(session, PERMISSIONS.CONTROL_APPROVE)}
      canAskAgents={can(session, PERMISSIONS.USE_AGENTS)}
      agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
      dimensions={portfolio.cohort_dimensions || []}
      cohorts={portfolio.cohorts || {}}
      today={new Date().toISOString()}
    />
  );
}
