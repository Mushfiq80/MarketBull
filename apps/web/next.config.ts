// Side-effect import: loads the repo-root .env before anything reads process.env.
import "./src/lib/load-env";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Financial values are decimal strings end to end; nothing to transform.
  experimental: {
    // Keep the Python service URL server-only.
    serverActions: { bodySizeLimit: "4mb" },
  },
  // lightweight-charts is client-only and lazy-loaded; keep it out of the server bundle.
  serverExternalPackages: ["pg"],
  logging: { fetches: { fullUrl: false } },
};

export default nextConfig;
