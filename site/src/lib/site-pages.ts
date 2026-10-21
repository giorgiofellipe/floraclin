import type { MetadataRoute } from "next";

/** Canonical origin of the marketing site. */
export const SITE_URL = "https://floraclin.com.br";

/** llms.txt sections, in the order they appear. */
export const LLMS_SECTIONS = ["Produto", "Guias e comparativos", "Legal"] as const;
export type LlmsSection = (typeof LLMS_SECTIONS)[number];

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
  /** Content pages only: <title> and meta description. */
  metaTitle?: string;
  description?: string;
  /** Content pages only: BR calendar day first published (YYYY-MM-DD). */
  published?: string;
  /** Content pages only: short label for the footer and related links. */
  linkLabel?: string;
}

/**
 * Single registry of the public, indexable pages of floraclin.com.br.
 *
 * The sitemap, llms.txt and the IndexNow ping are all built from this list,
 * so adding a page here is the only step needed to get it crawled.
 * `site-pages.test.ts` fails when a `page.tsx` exists under `src/app` that is
 * neither listed here nor in `NON_INDEXABLE_ROUTES`, so a new page can't be
 * forgotten.
 */
export const SITE_PAGES: readonly SitePage[] = [
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
  {
    path: "/melhores-sistemas-clinica-estetica-harmonizacao-2026",
    title: "Melhores sistemas para clínica de estética e harmonização (2026)",
    summary:
      "Comparativo de 11 sistemas para clínicas de estética e HOF com preços e recursos verificados nos sites oficiais, escrito pelo FloraClin e com o viés declarado.",
    updated: "2026-10-21",
    published: "2026-10-21",
    changeFrequency: "monthly",
    priority: 0.8,
    llmsSection: "Guias e comparativos",
    metaTitle: "Melhores sistemas para clínica de estética e HOF em 2026 | FloraClin",
    description:
      "Comparativo honesto de 11 sistemas para clínica de estética e harmonização: preço, teste grátis, prontuário, mapa facial e antes e depois. Fontes citadas.",
    linkLabel: "Comparativo de sistemas 2026",
  },
  {
    path: "/guia-fotos-antes-e-depois",
    title: "Guia de fotos de antes e depois padronizadas",
    summary:
      "Como padronizar fotos clínicas de antes e depois (luz, distância, ângulos e fundo), consentimento e LGPD, e o que CFM e CFO permitem publicar.",
    updated: "2026-10-21",
    published: "2026-10-21",
    changeFrequency: "monthly",
    priority: 0.8,
    llmsSection: "Guias e comparativos",
    metaTitle: "Fotos de antes e depois padronizadas: guia para HOF e estética | FloraClin",
    description:
      "Como padronizar fotos de antes e depois: luz, distância, ângulos e fundo, consentimento de imagem e LGPD, e as regras do CFM e do CFO para publicar.",
    linkLabel: "Guia de fotos de antes e depois",
  },
  {
    path: "/software-harmonizacao-orofacial",
    title: "Software para Harmonização Orofacial",
    summary:
      "O FloraClin para clínicas de HOF: diagrama facial com produto e quantidade por ponto, prontuário, fotos alinhadas automaticamente e teste grátis de 14 dias.",
    updated: "2026-10-21",
    published: "2026-10-21",
    changeFrequency: "monthly",
    priority: 0.9,
    llmsSection: "Guias e comparativos",
    metaTitle: "Software para Harmonização Orofacial (HOF) | FloraClin",
    description:
      "Diagrama facial com produto e quantidade por ponto, lote e validade no prontuário, fotos de antes e depois alinhadas automaticamente. 14 dias grátis, sem cartão.",
    linkLabel: "Software para HOF",
  },
  {
    path: "/alternativa-ao-clinicorp",
    title: "Alternativa ao Clinicorp para HOF e estética",
    summary:
      "Quando o FloraClin faz sentido no lugar do Clinicorp, e quando o Clinicorp é a melhor escolha, com preços verificados no site oficial.",
    updated: "2026-10-21",
    published: "2026-10-21",
    changeFrequency: "monthly",
    priority: 0.7,
    llmsSection: "Guias e comparativos",
    metaTitle: "Alternativa ao Clinicorp para clínicas de HOF e estética | FloraClin",
    description:
      "FloraClin ou Clinicorp? Preços verificados, o que cada um faz melhor e para qual clínica cada sistema serve. Comparativo escrito pelo FloraClin, com fontes.",
    linkLabel: "Alternativa ao Clinicorp",
  },
  {
    path: "/floraclin-vs-simplu",
    title: "FloraClin vs Simplu",
    summary:
      "Comparação entre FloraClin e Simplu, dois sistemas feitos para harmonização orofacial: preço, teste, mapa facial e antes e depois com IA.",
    updated: "2026-10-21",
    published: "2026-10-21",
    changeFrequency: "monthly",
    priority: 0.7,
    llmsSection: "Guias e comparativos",
    metaTitle: "FloraClin vs Simplu: comparativo para harmonização orofacial | FloraClin",
    description:
      "FloraClin ou Simplu? Preço, teste grátis, mapa facial e antes e depois alinhado lado a lado, com fontes oficiais e onde cada um é melhor.",
    linkLabel: "FloraClin vs Simplu",
  },
  {
    path: "/floraclin-vs-clinica-experts",
    title: "FloraClin vs Clínica Experts",
    summary:
      "Comparação entre FloraClin e Clínica Experts: preço, teste grátis, foco em HOF, diagrama facial e antes e depois, com fontes oficiais.",
    updated: "2026-10-21",
    published: "2026-10-21",
    changeFrequency: "monthly",
    priority: 0.7,
    llmsSection: "Guias e comparativos",
    metaTitle: "FloraClin vs Clínica Experts: comparativo | FloraClin",
    description:
      "FloraClin ou Clínica Experts? Preço, teste grátis, foco em HOF, diagrama facial e antes e depois, com fontes e os pontos em que cada um é melhor.",
    linkLabel: "FloraClin vs Clínica Experts",
  },
  {
    path: "/alternativa-ao-clinica-experts",
    title: "Alternativa ao Clínica Experts para HOF",
    summary:
      "Quando o FloraClin é uma alternativa ao Clínica Experts para clínicas de harmonização, e quando o Clínica Experts continua a melhor escolha.",
    updated: "2026-10-21",
    published: "2026-10-21",
    changeFrequency: "monthly",
    priority: 0.7,
    llmsSection: "Guias e comparativos",
    metaTitle: "Alternativa ao Clínica Experts para clínicas de HOF | FloraClin",
    description:
      "Procurando uma alternativa ao Clínica Experts? Veja preço, teste, diagrama facial e fotos alinhadas no FloraClin, e onde o Clínica Experts é melhor.",
    linkLabel: "Alternativa ao Clínica Experts",
  },
];

/** Routes that exist under src/app but must stay out of the sitemap. */
export const NON_INDEXABLE_ROUTES: readonly string[] = ["/motion-lab"];

/** Guides and comparisons, in the order the footer lists them. */
export const CONTENT_PAGES = SITE_PAGES.filter((page) => page.llmsSection === "Guias e comparativos");

export function sitePage(path: string): SitePage {
  const page = SITE_PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`${path} is not in SITE_PAGES`);
  return page;
}

export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/**
 * Noon in São Paulo on the given BR calendar day, so the date never flips.
 * A fixed -03:00 is safe: Brazil has had no DST since 2019. site/ has no
 * @/lib/dates; mirror web/src/lib/dates.ts parseBrDate if that changes.
 */
export function brDayToDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00-03:00`);
}
