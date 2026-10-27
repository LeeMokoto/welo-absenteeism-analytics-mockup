import { redirect } from "next/navigation";
import AppShell from "@/components/platform/AppShell";
import { getManifest, getNavigation } from "@/lib/platform/manifest";
import { getSession } from "@/lib/platform/session";
import { visibleNavigation } from "@/lib/platform/roles";
import { readRate } from "@/lib/platform/currency";

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
  const manifest = getManifest();
  const session = await getSession();

  if (!session) redirect("/signin");

  const navigation = visibleNavigation(getNavigation(manifest), session);

  // The exchange rate is configuration, so it is read here where the
  // environment is, and passed down rather than reached for in the client.
  const rate = readRate(process.env);

  return (
    <AppShell manifest={manifest} navigation={navigation} session={session} rate={rate}>
      {children}
    </AppShell>
  );
}
