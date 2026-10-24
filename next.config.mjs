/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Enables forbidden(), which lib/platform/guard.js uses to refuse a route
    // with a 403 rather than a 404 or a 200 carrying a denial page.
    //
    // Experimental, and acceptable here for one reason: it fails closed. If a
    // future Next removes or renames this, forbidden() throws, the request
    // becomes a 500, and access is still refused. The dependency is contained
    // in guard.js, so repairing it is one function. CI asserts a denial is a
    // 403, so a release that breaks it is caught rather than discovered.
    authInterrupts: true,
  },
  // Standalone output bundles a minimal server (.next/standalone/server.js) with
  // only the dependencies it needs, so the Cloud Run image stays small. Deployed
  // the same way as the absenteeism inference service: a container on Cloud Run
  // with the Anthropic key from Secret Manager.
  output: "standalone",
  // The original static absenteeism dashboard is staged into
  // public/absenteeism/ before the build (see scripts/stage-static-dashboard.mjs)
  // so this one deployment serves both products.
  //
  // This is a redirect, not a rewrite, and that matters: index.html loads its
  // config and feed by RELATIVE path. Rewriting /absenteeism would leave the
  // browser on a URL with no trailing segment, so "config/industry.js" would
  // resolve to /config/industry.js and 404. Redirecting to the real file keeps
  // the base at /absenteeism/ and the relative paths resolve. A trailing-slash
  // rewrite is not an option either: Next normalises /absenteeism/ back to
  // /absenteeism, which would loop.
  async redirects() {
    return [
      { source: "/absenteeism", destination: "/absenteeism/index.html", permanent: false },
    ];
  },
};

export default nextConfig;
