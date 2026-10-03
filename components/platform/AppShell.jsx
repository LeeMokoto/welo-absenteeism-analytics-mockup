"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/*
  The platform shell: a persistent frame around every module.

  This is the structural change from dashboard to platform. Previously each
  product was a page that scrolled, with capabilities bolted into it. Here the
  frame is constant (who you are, which tenant, what the platform can do) and
  modules occupy the content region. Adding a capability becomes adding a
  destination, not another panel on an already long page.

  Navigation comes from the tenant manifest, so a tenant that has not enabled a
  module never sees a door to it.
*/

function NavLink({ item, active }) {
  return (
    <Link
      href={item.href}
      className={"nav-item" + (active ? " active" : "")}
      aria-current={active ? "page" : undefined}
    >
      <span>{item.label}</span>
      {item.clinical ? (
        <span className="nav-badge" title="Clinically held, access controlled">
          clinical
        </span>
      ) : null}
    </Link>
  );
}

export default function AppShell({ manifest, navigation, children }) {
  const pathname = usePathname();

  // Every screen is a real route, so active state is a path comparison and the
  // shell needs no search params. That matters beyond tidiness: reading search
  // params would force a Suspense boundary here, and the resulting streamed
  // response commits a 200 before a disabled module's route can return its 404.
  const isActive = (href) => pathname === href;

  const t = manifest.tenant;

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">
          <Link href="/" className="shell-mark">welo.</Link>
          <span className="shell-product">Workforce Health Platform</span>
        </div>
        <div className="shell-tenant">
          <span className="shell-tenant-name">{t.name}</span>
          <span className={"shell-env " + (t.synthetic ? "is-synthetic" : "is-live")}>
            {t.environment}
          </span>
          {t.synthetic ? (
            <span className="shell-synthetic">Synthetic data</span>
          ) : null}
        </div>
      </header>

      <div className="shell-body">
        <nav className="shell-nav" aria-label="Platform navigation">
          {navigation.map((group) => (
            <div key={group.section} className="nav-group">
              <div className="nav-section">{group.section}</div>
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item.href)} />
              ))}
            </div>
          ))}
          <div className="nav-foot">
            Cohorts under {manifest.suppressionThreshold} are suppressed across every view.
          </div>
        </nav>

        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
