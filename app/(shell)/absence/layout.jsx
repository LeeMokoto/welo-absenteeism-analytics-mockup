import ModuleTabs from "@/components/platform/ModuleTabs";
import absenceModule from "@/modules/absence/module";

// Module layout: the header and screen tabs shared by every absence screen,
// taken from the module definition so the tabs and the sidebar cannot disagree.
export default function AbsenceLayout({ children }) {
  return (
    <div className="page">
      <header style={{ paddingTop: 36, maxWidth: 720 }}>
        <div className="eyebrow">{absenceModule.label}</div>
        <h1 style={{ fontSize: 28, marginTop: 10, letterSpacing: "-0.03em" }}>
          Absence and fatigue
        </h1>
        <p style={{ marginTop: 10, color: "var(--ink-mute)", fontSize: 14.5 }}>
          {absenceModule.summary}
        </p>
      </header>

      <ModuleTabs screens={absenceModule.screens} />
      <div style={{ marginTop: 24 }}>{children}</div>
    </div>
  );
}
