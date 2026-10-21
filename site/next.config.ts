import type { NextConfig } from "next";
import { indexNowKey } from "./src/lib/indexnow";

const nextConfig: NextConfig = {
  async rewrites() {
    // IndexNow key file at the site root, only when INDEXNOW_KEY is set.
    const key = indexNowKey();
    return key ? [{ source: `/${key}.txt`, destination: "/indexnow-key" }] : [];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
