import Link from "next/link";
import { getManifest } from "@/lib/platform/manifest";
import { aggregates as sickLeave, meta as sickLeaveMeta } from "@/modules/sick-leave/data/sampleData";
import { num, pct, randCompact } from "@/modules/sick-leave/format";

export const metadata = {
  title: "Overview | Welo Workforce Health Platform",
};

// The platform's landing screen: what this tenant runs and where the weight
// currently sits, with a route into each enabled module. Deliberately thin.
// Its job is orientation, not analysis; the modules do the analysis.
export default function Overview() {
  const manifest = getManifest();
  const m = manifest.modules;
  const sl = sickLeave.headline;

  return (
    <div className="page">
      <header style={{ paddingTop: 36, maxWidth: 680 }}>
        <div className="eyebrow">{manifest.tenant.name}</div>
        <h1 style={{ fontSize: 30, marginTop: 10, letterSpacing: "-0.03em" }}>Overview</h1>
        <p style={{ marginTop: 10, color: "var(--ink-mute)", fontSize: 14.5 }}>
          Modules enabled for this tenant, and where absence and entitlement currently
          concentrate. Every figure is cohort level and suppressed below{" "}
          {manifest.suppressionThreshold}.
        </p>
      </header>

      <div className="section grid grid-2">
        {m.absence ? (
          <ModuleCard
            href="/absence"
            tag="Absence analytics"
            title="Absence and fatigue"
            body="Predicted absence, fatigue and cost exposure across the covered workforce, with live what-if scoring against the trained model."
            stats={[]}
          />
        ) : null}

        {m.sickLeave ? (
          <ModuleCard
            href="/sick-leave"
            tag="Sick leave"
            title="Statutory sick leave"
            body="BCEA entitlement burn, condition mix at chapter level, cover planning and certification compliance."
            stats={[
              ["Sick leave rate", pct(sl.sickLeaveRatePct)],
              ["Sick days", num(sl.totalSickDays)],
              ["Indicative cost", randCompact(sl.indicativeCostRand)],
              ["Covered", num(sickLeaveMeta.cohortSize)],
            ]}
          />
        ) : null}
      </div>

      {!m.controlCentre ? (
        <div className="section">
          <div className="card cream">
            <div className="eyebrow">Next phase</div>
            <div className="card-title" style={{ marginTop: 10 }}>Control centre</div>
            <p className="card-note" style={{ marginBottom: 0 }}>
              Interventions, alert rules, playbooks and outcome tracking, so cohorts are acted
              on inside the platform rather than exported. Not enabled for this tenant: it is
              switched on per tenant once the actions store and the outbound task integration
              have passed their delta test.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModuleCard({ href, tag, title, body, stats }) {
  return (
    <Link
      href={href}
      className="card product-card"
      style={{ textDecoration: "none", color: "var(--ink)", display: "block" }}
    >
      <div className="eyebrow">{tag}</div>
      <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 10 }}>
        {title}
      </div>
      <p style={{ marginTop: 10, color: "var(--ink-mute)", fontSize: 13.5, lineHeight: 1.55 }}>
        {body}
      </p>
      {stats.length ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 12,
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid var(--line-soft)",
          }}
        >
          {stats.map(([label, value]) => (
            <div key={label}>
              <div className="caption">{label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 2 }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ marginTop: 18, color: "var(--red)", fontSize: 13, fontWeight: 500 }}>
        Open module
      </div>
    </Link>
  );
}
