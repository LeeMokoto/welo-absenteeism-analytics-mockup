import GovernanceNote from "@/components/sick-leave/GovernanceNote";
import ModuleTabs from "@/components/platform/ModuleTabs";
import { meta } from "@/lib/sick-leave/sampleData";
import { num } from "@/lib/sick-leave/format";

// Module layout: the header and screen tabs shared by every sick-leave screen.
// The tabs are links to real routes, mirroring the sidebar, so a screen can be
// bookmarked and sent to a colleague.
const SCREENS = [
  { href: "/sick-leave", label: "Portfolio and cohorts" },
  { href: "/sick-leave/case", label: "Case view" },
  { href: "/sick-leave/ops", label: "HR and operations" },
];

export default function SickLeaveLayout({ children }) {
  return (
    <div className="page">
      <header style={{ paddingTop: 36 }}>
        <div className="eyebrow">Sick leave intelligence</div>
        <h1 style={{ fontSize: 28, marginTop: 10, letterSpacing: "-0.03em" }}>
          Statutory sick leave
        </h1>
        <p style={{ marginTop: 10, maxWidth: 720, color: "var(--ink-mute)", fontSize: 14.5 }}>
          Oriented at care pathways and workforce planning. A mining division of{" "}
          {num(meta.cohortSize)} employees across {meta.siteCount} sites. Not used for HR review
          or disciplinary purposes.
        </p>
      </header>

      <ModuleTabs screens={SCREENS} />
      <div style={{ marginTop: 24 }}>{children}</div>
      <GovernanceNote />
    </div>
  );
}
