"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/*
  An Entra-style account chooser, standing in for the client's identity
  provider.

  The resemblance is the point: this is where a SAML or OIDC redirect will go,
  and a reviewer should recognise the shape. The banner is also the point. A
  login screen that looks real and is not is the single most misreadable thing
  in a demo, so it says what it is above the fold rather than in a footnote.

  Picking an account sets a cookie holding a role key. Every permission check
  downstream is real.
*/

const INITIALS = (name) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

export default function AccountPicker({ accounts }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function choose(email) {
    setBusy(email);
    setError("");
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Sign-in failed (${res.status}).`);
      }
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e.message);
      setBusy("");
    }
  }

  return (
    <div className="signin-page">
      <div className="signin-card">
        <div className="signin-mock">
          Mocked sign-in. There is no identity provider behind this screen and no credential is
          checked. Choosing an account sets a role, and every permission check after that is real.
        </div>

        <div className="signin-brand">
          <span className="shell-mark">welo.</span>
          <span className="shell-product">Workforce Health Platform</span>
        </div>

        <h1 className="signin-title">Pick an account</h1>
        <p className="signin-sub">
          In a client tenant this is the client&apos;s own identity provider, and the role comes
          from their group membership.
        </p>

        <div className="signin-accounts">
          {accounts.map((a) => (
            <button
              key={a.email}
              className="signin-account"
              onClick={() => choose(a.email)}
              disabled={!!busy}
            >
              <span className="signin-avatar" aria-hidden="true">{INITIALS(a.name)}</span>
              <span className="signin-who">
                <span className="signin-name">{a.name}</span>
                <span className="signin-email">{a.email}</span>
                <span className="signin-access">
                  {a.roleLabel}
                  {a.permissionCount === 0 ? ", no application access by default" : ""}
                </span>
              </span>
              {busy === a.email ? <span className="signin-busy">signing in</span> : null}
            </button>
          ))}
        </div>

        {error ? <div className="signin-error">{error}</div> : null}

        <div className="signin-foot">
          Addresses are on example.com, which is reserved and cannot be registered, so none of
          these is a real mailbox.
        </div>
      </div>
    </div>
  );
}
