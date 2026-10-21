import type { MetadataRoute } from "next";

/**
 * Single registry of the public, indexable pages of floraclin.com.br.
 *
 * The sitemap, llms.txt and the IndexNow ping are all built from this list,
 * so adding a page here is the only step needed to get it crawled.
 * `site-pages.test.ts` fails when a `page.tsx` exists under `src/app` that is
 * neither listed here nor in `NON_INDEXABLE_ROUTES`, so a new page can't be
 * forgotten.
 */
export const SITE_URL = "https://floraclin.com.br";

export type LlmsSection = "Produto" | "Guias e comparativos" | "Legal";

export interface SitePage {
  /** Route path, starting with "/". */
  path: string;
  /** Short title used in llms.txt. */
  title: string;
  /** One-line summary used in llms.txt. */
  summary: string;
  /** BR calendar day the page content last changed (YYYY-MM-DD). */
  updated: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
  llmsSection: LlmsSection;
}

export const SITE_PAGES: SitePage[] = [
  {
    path: "/",
    title: "FloraClin",
    summary:
      "Sistema de gestão para clínicas de Harmonização Orofacial: agenda, prontuário, diagrama facial, fotos de antes e depois com alinhamento automático, financeiro e WhatsApp.",
    updated: "2026-10-21",
    changeFrequency: "weekly",
    priority: 1,
    llmsSection: "Produto",
  },
  {
    path: "/termos",
    title: "Termos de Uso",
    summary: "Termos de uso da plataforma FloraClin.",
    updated: "2026-05-31",
    changeFrequency: "monthly",
    priority: 0.3,
    llmsSection: "Legal",
  },
  {
    path: "/privacidade",
    title: "Política de Privacidade",
    summary: "Como a FloraClin trata dados pessoais.",
    updated: "2026-10-06",
    changeFrequency: "monthly",
    priority: 0.3,
    llmsSection: "Legal",
  },
  {
    path: "/lgpd",
    title: "LGPD",
    summary: "Direitos do titular e contato do encarregado de dados.",
    updated: "2026-10-06",
    changeFrequency: "monthly",
    priority: 0.3,
    llmsSection: "Legal",
  },
];

/** Routes that exist under src/app but must stay out of the sitemap. */
export const NON_INDEXABLE_ROUTES = ["/motion-lab"];

export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/** Noon in São Paulo on the given BR calendar day, so the date never flips. */
export function brDayToDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00-03:00`);
}
