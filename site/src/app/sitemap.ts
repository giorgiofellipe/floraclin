import type { MetadataRoute } from "next";
import { isReferralRulesPagePublished } from "@/lib/referral-lookup";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://floraclin.com.br";
  const termsLastModified = new Date("2026-05-31T12:00:00-03:00");
  const legalLastModified = new Date("2026-10-06T12:00:00-03:00");

  const entries: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/termos`, lastModified: termsLastModified, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/privacidade`, lastModified: legalLastModified, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/lgpd`, lastModified: legalLastModified, changeFrequency: "monthly", priority: 0.3 },
  ];

  if (isReferralRulesPagePublished()) {
    entries.push({
      url: `${base}/indique`,
      lastModified: new Date("2026-10-21T12:00:00-03:00"),
      changeFrequency: "monthly",
      priority: 0.3,
    });
  }

  return entries;
}
