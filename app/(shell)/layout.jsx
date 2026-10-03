import AppShell from "@/components/platform/AppShell";
import { getManifest, getNavigation } from "@/lib/platform/manifest";

// Server layout: reads the tenant manifest (server side, where the config lives)
// and hands the shell only what it needs to render. A route group, so every
// module keeps the URL it already had.
//
// No Suspense boundary here on purpose. The shell derives active state from the
// pathname alone, so nothing suspends, and a disabled module's notFound() can
// still set a 404 instead of being overtaken by a streamed 200.
export default function ShellLayout({ children }) {
  const manifest = getManifest();
  const navigation = getNavigation(manifest);

  return (
    <AppShell manifest={manifest} navigation={navigation}>
      {children}
    </AppShell>
  );
}
