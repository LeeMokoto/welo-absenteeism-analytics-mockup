import OpsScreen from "@/components/sick-leave/OpsScreen";
import { aggregates, meta } from "@/lib/sick-leave/sampleData";

export const dynamic = "force-dynamic";

export default function SickLeaveOps() {
  return (
    <OpsScreen
      aggregates={aggregates}
      meta={meta}
      agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}
