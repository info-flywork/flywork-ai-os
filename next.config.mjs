

const nextConfig = {
  poweredByHeader: false,
  cacheComponents: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "32mb",
    },
  },
  partialPrefetching: true,
  serverExternalPackages: ["mariadb", "@prisma/adapter-mariadb", "@prisma/client", "pdfjs-dist", "@napi-rs/canvas"],
  async headers() {
    const shared = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      {
        source: "/:path*",
        headers: shared,
      },
      {
        source: "/((?!uygulama-paneli).*)",
        missing: [{ type: "host", value: "apppanel.localhost" }],
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/uygulama-paneli/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "apppanel.localhost" }],
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors http://localhost:3000 http://127.0.0.1:3000 http://localhost:3010 http://127.0.0.1:3010",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/uygulama-paneli",
          destination: "/api/app-panel-proxy/panel",
        },
        {
          source: "/uygulama-paneli/:path*",
          destination: "/api/app-panel-proxy/:path*",
        },
        {
          source: "/:path*",
          has: [{ type: "host", value: "apppanel.localhost" }],
          missing: [{ type: "header", key: "x-flywork-app-panel" }],
          destination: "/api/app-panel-proxy/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
