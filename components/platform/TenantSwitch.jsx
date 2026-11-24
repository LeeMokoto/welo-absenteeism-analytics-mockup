"use client";

import { TENANT_COOKIE } from "@/lib/platform/tenants";

/*
  The demo tenant switch.

  Shown only on a synthetic demo that has not pinned a sector, and only when
  the build carries more than one tenant (the shell decides; see tenants.js).
  Choosing a tenant sets a cookie the server reads on every request, then
  reloads, so every figure on screen, every agent lookup and every draft held
  in the browser belongs to the tenant now named in the header. A screen the
  other tenant does not carry would answer 404, so a switch from one of those
  lands on the overview instead.
*/
export default function TenantSwitch({ current, tenants = [], modulePaths = {} }) {
  if (tenants.length < 2) return null;

  function choose(key) {
    if (key === current) return;
    document.cookie = `${TENANT_COOKIE}=${encodeURIComponent(key)}; path=/; max-age=31536000; samesite=lax`;
    const here = window.location.pathname;
    const missing = (modulePaths[key] || []).some((p) => here === p || here.startsWith(p + "/"));
    window.location.assign(missing ? "/" : here + window.location.search);
  }

  return (
    <span className="ccy-toggle" role="group" aria-label="Demo tenant" title="Switch between the demo groups">
      {tenants.map((t) => (
        <button
          key={t.key}
          type="button"
          className={"ccy-btn" + (t.key === current ? " active" : "")}
          aria-pressed={t.key === current}
          onClick={() => choose(t.key)}
        >
          {t.short || t.name}
        </button>
      ))}
    </span>
  );
}
