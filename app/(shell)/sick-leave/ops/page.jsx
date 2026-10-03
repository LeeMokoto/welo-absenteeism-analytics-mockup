import OpsScreen from "@/modules/sick-leave/screens/OpsScreen";
import { aggregates, meta } from "@/modules/sick-leave/data/sampleData";

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
