import type { MetadataRoute } from "next";
import { isReferralRulesPagePublished } from "@/lib/referral-lookup";
import { SITE_PAGES, absoluteUrl, brDayToDate } from "@/lib/site-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = SITE_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: brDayToDate(page.updated),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));

  // The referral rules page is published only while the program runs or winds
  // down (see isReferralRulesPagePublished), so it is listed here rather than
  // in SITE_PAGES, which feeds llms.txt and IndexNow unconditionally.
  if (isReferralRulesPagePublished()) {
    entries.push({
      url: absoluteUrl("/indique"),
      lastModified: brDayToDate("2026-10-21"),
      changeFrequency: "monthly",
      priority: 0.3,
    });
  }

  return entries;
}
