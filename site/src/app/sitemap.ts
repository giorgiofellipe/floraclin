import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://floraclin.com.br";

  return [
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/termos`, lastModified: new Date("2026-05-31"), changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/privacidade`, lastModified: new Date("2026-05-31"), changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/lgpd`, lastModified: new Date("2026-05-31"), changeFrequency: "monthly", priority: 0.3 },
  ];
}
