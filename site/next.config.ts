import type { NextConfig } from "next";
import { indexNowKey } from "./src/lib/indexnow";

const nextConfig: NextConfig = {
  async redirects() {
    // The comparison was first planned under this slug; keep it pointing at
    // the canonical 2026 page.
    return [
      {
        source: "/melhores-sistemas-para-clinica-de-estetica",
        destination: "/melhores-sistemas-clinica-estetica-harmonizacao-2026",
        statusCode: 301,
      },
    ];
  },
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
