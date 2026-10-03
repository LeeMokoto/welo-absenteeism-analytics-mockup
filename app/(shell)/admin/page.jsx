import { getManifest } from "@/lib/platform/manifest";

export const metadata = { title: "Tenant and modules | Welo" };
export const dynamic = "force-dynamic";

/*
  Administration: what this tenant is configured to be.

  Read-only on purpose. In the platform the manifest is a file in the repository
  that Terraform and the application both read, and it changes through a pull
  request with review, never through a screen. Showing it here makes the
  configuration visible to whoever is in the tenant without implying it can be
  edited from inside.
*/
export default function AdminPage() {
  const manifest = getManifest();
  const t = manifest.tenant;
  const modules = [
    ["Absence analytics", manifest.modules.absence, "WELO_MODULE_ABSENCE"],
    ["Sick leave", manifest.modules.sickLeave, "WELO_MODULE_SICK_LEAVE"],
    ["Control centre", manifest.modules.controlCentre, "WELO_MODULE_CONTROL_CENTRE"],
  ];

  return (
    <div className="page">
      <header style={{ paddingTop: 36, maxWidth: 720 }}>
        <div className="eyebrow">Administration</div>
        <h1 style={{ fontSize: 28, marginTop: 10, letterSpacing: "-0.03em" }}>
          Tenant and modules
        </h1>
        <p style={{ marginTop: 10, color: "var(--ink-mute)", fontSize: 14.5 }}>
          The manifest this deployment is running. It is set in configuration and changed through
          review, not from this screen.
        </p>
      </header>

      <div className="section grid grid-2">
        <div className="card">
          <div className="card-title">Tenant</div>
          <p className="card-note">Identity and data classification.</p>
          <table className="data">
            <tbody>
              <tr><td>Name</td><td>{t.name}</td></tr>
              <tr><td>Environment</td><td>{t.environment}</td></tr>
              <tr><td>Data</td><td>{t.synthetic ? "Synthetic" : "Client data"}</td></tr>
              <tr><td>Suppression threshold</td><td>{manifest.suppressionThreshold}</td></tr>
            </tbody>
          </table>
          <div className="indicative" style={{ marginTop: 12 }}>
            The threshold may be raised for a tenant, never set below five.
          </div>
        </div>

        <div className="card">
          <div className="card-title">Modules</div>
          <p className="card-note">Navigation follows this: a module that is off has no door.</p>
          <table className="data">
            <thead>
              <tr><th>Module</th><th>State</th><th>Set by</th></tr>
            </thead>
            <tbody>
              {modules.map(([label, on, key]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>
                    <span className={"tier " + (on ? "Low" : "Moderate")}>
                      {on ? "enabled" : "off"}
                    </span>
                  </td>
                  <td className="caption">{key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
