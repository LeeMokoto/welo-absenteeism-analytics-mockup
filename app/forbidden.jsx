import Link from "next/link";

/*
  Rendered when a route guard refuses. Says which role is signed in and what
  that role may do, because the common cause is a bookmark kept after a role
  change, and "forbidden" alone sends the reader to support rather than to the
  account picker.
*/
export default function Forbidden() {
  return (
    <div className="signin-page">
      <div className="signin-card">
        <div className="signin-brand">
          <span className="shell-mark">welo.</span>
          <span className="shell-product">Workforce Health Platform</span>
        </div>
        <h1 className="signin-title">Not available to this role</h1>
        <p className="signin-sub">
          The screen exists and your role does not reach it. Roles come from group membership in a
          client tenant; in this demo they come from the account you picked.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <Link className="lens-btn active" href="/">Back to the overview</Link>
          <Link className="lens-btn" href="/signin">Pick a different account</Link>
        </div>
      </div>
    </div>
  );
}
