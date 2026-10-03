"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/*
  Tabs for the screens within a module.

  The sidebar shows the same destinations, which is deliberate rather than
  redundant: the sidebar is how you move between modules and see everything the
  tenant runs, the tabs are how you move within the module you are already in.
  Both point at the same real routes, so either is bookmarkable.
*/
export default function ModuleTabs({ screens }) {
  const pathname = usePathname();
  return (
    <div className="tabs" role="tablist" aria-label="Module screens">
      {screens.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className="tab"
          role="tab"
          aria-selected={pathname === s.href}
        >
          {s.label}
        </Link>
      ))}
    </div>
  );
}
