// The hub for the two Welo dashboards. Both are served from this deployment:
// the sick-leave app is a Next route, and the original absenteeism dashboard is
// staged into public/absenteeism before the build.
export const metadata = {
  title: "Welo Workforce Health Intelligence",
  description:
    "Absenteeism and sick leave intelligence for large South African employers.",
};

const PRODUCTS = [
  {
    href: "/absenteeism",
    tag: "Absenteeism intelligence",
    title: "Absenteeism and fatigue",
    blurb:
      "Predicted absence, fatigue and cost exposure across the covered workforce, with live what-if scoring against the trained model and three AI assistants.",
    points: [
      "Portfolio, cohorts, outcomes and ROI",
      "Live what-if: pull an operational lever, re-score the real cohort",
      "Mining, manufacturing, logistics and generic framings",
    ],
  },
  {
    href: "/sick-leave",
    tag: "Sick leave intelligence",
    title: "Statutory sick leave",
    blurb:
      "BCEA sick leave entitlement, condition mix and cover planning, oriented at care pathways and workforce planning. Never used for HR review or disciplinary purposes.",
    points: [
      "Entitlement burn and exhaustion forecasting",
      "Clinically held case view, access controlled and audit logged",
      "Cover gap, overtime and certification compliance",
    ],
  },
];

export default function Home() {
  return (
    <main className="page">
      <header style={{ paddingTop: 72, maxWidth: 720 }}>
        <div className="eyebrow">Welo Health</div>
        <h1 style={{ fontSize: 44, marginTop: 12, lineHeight: 1.08, letterSpacing: "-0.035em" }}>
          Workforce health intelligence
        </h1>
        <p style={{ marginTop: 16, fontSize: 16, color: "var(--ink-mute)", lineHeight: 1.55 }}>
          Two dashboards over the same workforce: what absence is costing and where it
          concentrates, and how statutory sick leave entitlement is being consumed.
        </p>
      </header>

      <div className="section grid grid-2" style={{ marginTop: 40 }}>
        {PRODUCTS.map((p) => (
          <a
            key={p.href}
            href={p.href}
            className="card product-card"
            style={{ textDecoration: "none", color: "var(--ink)", display: "block" }}
          >
            <div className="eyebrow">{p.tag}</div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.025em",
                marginTop: 12,
              }}
            >
              {p.title}
            </div>
            <p style={{ marginTop: 10, color: "var(--ink-mute)", fontSize: 13.5, lineHeight: 1.55 }}>
              {p.blurb}
            </p>
            <ul
              style={{
                margin: "16px 0 0",
                paddingLeft: 18,
                fontSize: 13,
                color: "var(--ink-soft)",
                lineHeight: 1.7,
              }}
            >
              {p.points.map((pt) => (
                <li key={pt}>{pt}</li>
              ))}
            </ul>
            <div
              style={{
                marginTop: 22,
                paddingTop: 16,
                borderTop: "1px solid var(--line-soft)",
                color: "var(--red)",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Open dashboard
            </div>
          </a>
        ))}
      </div>

      <footer className="govnote">
        <p style={{ margin: 0 }}>
          Both dashboards run on synthetic sample data. Model output is labelled as modelled, Rand
          figures are indicative and pre-data, and the AI assistants propose while a human decides
          the action.
        </p>
      </footer>
    </main>
  );
}
