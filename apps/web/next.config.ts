import type { NextConfig } from "next";

// The same repo also deploys to a retired Vercel project whose domains are still baked into
// web_app buttons in old bot messages. Send those visitors to production; the query string and
// Telegram's #tgWebAppData fragment survive the redirect, and initData is bound to the bot, not the host.
const PRODUCTION_ORIGIN = "https://hafsauztoza.vercel.app";
const RETIRED_HOSTS = "hafsaustoza\\.vercel\\.app|hafsa-voronka-nu\\.vercel\\.app";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@funnel/shared"],
  allowedDevOrigins: ["*.trycloudflare.com"],
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: `(${RETIRED_HOSTS})` }],
        destination: `${PRODUCTION_ORIGIN}/:path*`,
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/index.html" },
        { source: "/a", destination: "/a/index.html" },
        { source: "/b", destination: "/b/index.html" },
        { source: "/c", destination: "/c/index.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    agentUpgrade: "security",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
