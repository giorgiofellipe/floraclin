import type { MetadataRoute } from "next";
import { SITE_PAGES, absoluteUrl, brDayToDate } from "@/lib/site-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: brDayToDate(page.updated),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
