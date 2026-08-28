import SampleBanner from "@/components/sick-leave/SampleBanner";

// The hub for the two Welo dashboards. Both are served from this deployment:
// the sick-leave app is a Next route, and the original absenteeism dashboard is
// staged into public/absenteeism before the build.
export const metadata = {
  title: "Welo Workforce Health Intelligence",
  description:
    "Absenteeism and sick leave intelligence for large South African employers. Synthetic sample data.",
};

const PRODUCTS = [
  {
    href: "/absenteeism",
    tag: "ABSENTEEISM INTELLIGENCE",
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
    tag: "SICK LEAVE INTELLIGENCE",
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
    <>
      <SampleBanner />
      <main className="page">
        <header style={{ paddingTop: 48, maxWidth: 760 }}>
          <div className="mono" style={{ color: "var(--brown)" }}>WELO HEALTH</div>
          <h1 style={{ fontSize: 40, marginTop: 10, lineHeight: 1.15 }}>
            Workforce health intelligence
          </h1>
          <p style={{ marginTop: 14, fontSize: 17, color: "var(--ink-soft)" }}>
            Two dashboards over the same workforce: what absence is costing and where it
            concentrates, and how statutory sick leave entitlement is being consumed. Both run on
            synthetic sample data.
          </p>
        </header>

        <div className="section grid grid-2">
          {PRODUCTS.map((p) => (
            <a
              key={p.href}
              href={p.href}
              className="card product-card"
              style={{ textDecoration: "none", color: "var(--ink)", display: "block" }}
            >
              <div className="mono" style={{ color: "var(--brick-deep)" }}>{p.tag}</div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 24,
                  marginTop: 10,
                  borderBottom: "2px solid var(--brick)",
                  paddingBottom: 10,
                }}
              >
                {p.title}
              </div>
              <p style={{ marginTop: 12, color: "var(--ink-soft)", fontSize: 14.5 }}>{p.blurb}</p>
              <ul style={{ margin: "14px 0 0", paddingLeft: 18, fontSize: 13.5, color: "var(--ink-soft)" }}>
                {p.points.map((pt) => (
                  <li key={pt} style={{ marginBottom: 4 }}>{pt}</li>
                ))}
              </ul>
              <div className="mono" style={{ color: "var(--brick-deep)", marginTop: 18 }}>
                Open dashboard
              </div>
            </a>
          ))}
        </div>

        <footer className="govnote">
          <p style={{ margin: 0 }}>
            All figures in both dashboards are synthetic. No client data is present. Model output is
            labelled as modelled, Rand figures are indicative and pre-data, and the AI assistants
            propose while a human decides the action.
          </p>
        </footer>
      </main>
    </>
  );
}
