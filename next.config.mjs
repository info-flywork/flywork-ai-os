

const nextConfig = {
  poweredByHeader: false,
  cacheComponents: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "24mb",
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
        source: "/:path*",
        missing: [{ type: "host", value: "apppanel.localhost" }],
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
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
