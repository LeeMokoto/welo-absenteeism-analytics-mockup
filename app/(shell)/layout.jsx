import { redirect } from "next/navigation";
import AppShell from "@/components/platform/AppShell";
import { getNavigation } from "@/lib/platform/manifest";
import { getSession } from "@/lib/platform/session";
import { visibleNavigation } from "@/lib/platform/roles";
import { readRate } from "@/lib/platform/currency";
import { availableTenants, getTenantManifest } from "@/lib/platform/tenantContext";
import { getManifest } from "@/lib/platform/manifest";
import { ALL_MODULES } from "@/modules/registry";

/*
  Server layout: reads the tenant manifest and the session, and hands the shell
  only what it needs to render.

  No Suspense boundary here on purpose. The shell derives active state from the
  pathname alone, so nothing suspends, and a disabled module's notFound() can
  still set a 404 instead of being overtaken by a streamed 200.

  Navigation is filtered to what the session may actually open. That is a
  courtesy, not the control: each screen checks its own permission, because a
  hidden menu item is not a control and the solution design says so.
*/
export default async function ShellLayout({ children }) {
  const manifest = await getTenantManifest();
  const session = await getSession();

  if (!session) redirect("/signin");

  const navigation = visibleNavigation(getNavigation(manifest), session);

  // The exchange rate is configuration, so it is read here where the
  // environment is, and passed down rather than reached for in the client.
  const rate = readRate(process.env);

  // The demo tenant switch: which groups this build carries, and for each one
  // the module paths it does not have, so switching from one of those screens
  // lands on the overview rather than a 404.
  const tenants = manifest.tenant.switchable ? availableTenants() : [];
  const modulePaths = Object.fromEntries(
    tenants.map(({ key }) => {
      const m = getManifest({ tenant: key }).modules;
      const off = ALL_MODULES.filter((mod) => !m[mod.enabledBy]);
      // A module's screens share its first path segment (/sick-leave/...).
      return [key, off.map((mod) => "/" + String(mod.screens?.[0]?.href || "").split("/")[1]).filter((p) => p !== "/")];
    })
  );

  return (
    <AppShell
      manifest={manifest}
      navigation={navigation}
      session={session}
      rate={rate}
      tenants={tenants}
      modulePaths={modulePaths}
    >
      {children}
    </AppShell>
  );
}
