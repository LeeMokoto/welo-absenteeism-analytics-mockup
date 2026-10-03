import AbsencePortfolioScreen from "@/modules/absence/screens/PortfolioScreen";
import absenceModule from "@/modules/absence/module";

export const metadata = { title: "Absence analytics | Welo" };
export const dynamic = "force-dynamic";

// The absence module's portfolio screen, now running inside the shell. The
// remaining screens are still served by the standalone build and are marked
// external in the module definition until they are ported.
export default function AbsencePage() {
  const pending = absenceModule.screens.filter((s) => s.external);

  return (
    <div className="page">
      <header style={{ paddingTop: 36, maxWidth: 720 }}>
        <div className="eyebrow">Absence analytics</div>
        <h1 style={{ fontSize: 28, marginTop: 10, letterSpacing: "-0.03em" }}>
          Absence and fatigue
        </h1>
        <p style={{ marginTop: 10, color: "var(--ink-mute)", fontSize: 14.5 }}>
          {absenceModule.summary}
        </p>
      </header>

      <div style={{ marginTop: 24 }}>
        <AbsencePortfolioScreen />
      </div>

      {pending.length ? (
        <div className="section">
          <div className="card cream">
            <div className="card-title">Still in the standalone build</div>
            <p className="card-note">
              These screens have not been ported into the shell yet and open outside the frame.
              Their routes do not change when they are ported.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {pending.map((s) => (
                <a key={s.href} className="chip" href={s.href}>
                  {s.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
