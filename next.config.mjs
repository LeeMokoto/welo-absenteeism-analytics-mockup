/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The existing static absenteeism dashboard (root index.html) is deployed
  // separately to a bucket; this Next app owns only the /sick-leave route and
  // its agent API. Nothing here fetches data at runtime.
};

export default nextConfig;
