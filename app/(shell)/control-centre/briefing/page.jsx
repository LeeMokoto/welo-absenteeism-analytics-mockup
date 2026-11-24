import BriefingScreen from "@/modules/control-centre/screens/BriefingScreen";
import { guard } from "@/lib/platform/guard";
import { PERMISSIONS, can } from "@/lib/platform/roles";
import { getCohortSeries, getPortfolio, getTenantManifest } from "@/lib/platform/tenantContext";
import { plannerTriggers } from "@/modules/absence/plannerTriggers";
import { hasStaffingCost, summary } from "@/modules/absence/staffingCost";

export const metadata = { title: "Briefing | Control centre | Welo" };
export const dynamic = "force-dynamic";

/*
  Reading the briefing needs only CONTROL_VIEW. It composes what the other
  screens publish and adds no reach of its own, so anyone who can read those
  can read this.

  asOf is computed on the server so every reader of one render sees the same
  "waiting 51 days", rather than a figure that depends on the clock of the
  browser it happened to open in.
*/
export default async function BriefingPage() {
  const portfolio = await getPortfolio();
  const cohortSeries = await getCohortSeries();
  const session = await guard(PERMISSIONS.CONTROL_VIEW);

  const manifest = await getTenantManifest();
  const now = new Date();
  // The week the briefing is for: this week's Monday.
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const weekOf = monday.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const block = hasStaffingCost(portfolio) ? portfolio.staffing_cost : null;
  return (
    <BriefingScreen
      dimensions={portfolio.cohort_dimensions || []}
      cohorts={portfolio.cohorts || {}}
      series={cohortSeries}
      suppressionThreshold={manifest.suppressionThreshold}
      tenant={manifest.tenant}
      asOf={now.toISOString().slice(0, 10)}
      now={now.toISOString()}
      weekOf={weekOf}
      dayRate={portfolio.hr_ops?.assumptions?.day_rate_rand ?? null}
      triggers={plannerTriggers(portfolio, { today: now })}
      staffingCost={block ? summary(block) : null}
      riskByDepartment={block ? block.forecast.by_department : []}
      agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
      canAskAgents={can(session, PERMISSIONS.USE_AGENTS)}
    />
  );
}
