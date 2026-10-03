import CaseScreenLoader from "./CaseScreenLoader";

export const dynamic = "force-dynamic";

// The clinical case view. Its per-record data is heavy, so the screen itself is
// loaded on the client only when this route is opened.
export default function SickLeaveCase() {
  return <CaseScreenLoader agentsAvailable={Boolean(process.env.ANTHROPIC_API_KEY)} />;
}
