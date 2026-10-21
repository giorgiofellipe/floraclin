import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { SignupLink } from "@/components/signup-link";
import { CONTENT_PAGES, SITE_URL, absoluteUrl, brDayToDate, sitePage } from "@/lib/site-pages";

export interface FaqItem {
  question: string;
  answer: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

/** <title>, description, canonical and Open Graph for a registered content page. */
export function contentPageMetadata(path: string): Metadata {
  const page = sitePage(path);
  const title = page.metaTitle ?? page.title;
  const description = page.description ?? page.summary;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      siteName: "FloraClin",
      title,
      description,
      url: absoluteUrl(path),
      type: "article",
      locale: "pt_BR",
      // A page-level openGraph replaces the layout's, file-based image included.
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "FloraClin — Gestão para clínicas de HOF" }],
      publishedTime: brDayToDate(page.published ?? page.updated).toISOString(),
      modifiedTime: brDayToDate(page.updated).toISOString(),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

function structuredData(path: string, faqs: FaqItem[], article: boolean) {
  const page = sitePage(path);
  const url = absoluteUrl(path);
  const organization = {
    "@type": "Organization",
    name: "FloraClin",
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/logo-symbol.png` },
  };
  const schemas: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "FloraClin", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: page.title, item: url },
      ],
    },
  ];
  if (article) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: page.title,
      description: page.description ?? page.summary,
      inLanguage: "pt-BR",
      datePublished: brDayToDate(page.published ?? page.updated).toISOString(),
      dateModified: brDayToDate(page.updated).toISOString(),
      author: organization,
      publisher: organization,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      image: `${SITE_URL}/opengraph-image`,
    });
  }
  if (faqs.length > 0) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }
  return schemas;
}

interface ContentPageProps {
  path: string;
  eyebrow: string;
  /** Visible H1. Defaults to the registry title. */
  heading?: string;
  quickAnswer: ReactNode;
  faqs: FaqItem[];
  /** Article JSON-LD for guides and comparisons. Off for product landing pages. */
  article?: boolean;
  /** Paths of related content pages to link at the end. */
  related?: string[];
  ctaTitle?: string;
  ctaText?: string;
  children: ReactNode;
}

export function ContentPage({
  path,
  eyebrow,
  heading,
  quickAnswer,
  faqs,
  article = true,
  related,
  ctaTitle = "Teste o FloraClin na sua clínica",
  ctaText = "14 dias grátis, sem cartão de crédito. Depois, planos a partir de R$ 99/mês.",
  children,
}: ContentPageProps) {
  const page = sitePage(path);
  const relatedPages = (related ?? CONTENT_PAGES.map((p) => p.path))
    .filter((p) => p !== path)
    .map((p) => sitePage(p));

  return (
    <>
      <Navigation />
      <main className="bg-cream pt-28 md:pt-36 pb-16 md:pb-24">
        <article className="mx-auto max-w-[760px] px-6">
          <nav aria-label="Você está em" className="text-sm text-mid mb-6">
            <Link href="/" className="text-sage hover:text-forest no-underline">
              FloraClin
            </Link>
            <span aria-hidden="true"> / </span>
            <span aria-current="page">{page.linkLabel ?? page.title}</span>
          </nav>
          <p className="section-label mb-4">{eyebrow}</p>
          <h1 className="text-[2rem] leading-tight md:text-5xl md:leading-[1.1] mb-4">
            {heading ?? page.title}
          </h1>
          <p className="text-sm text-mid mb-10">
            Atualizado em{" "}
            <time dateTime={page.updated}>{DATE_FORMAT.format(brDayToDate(page.updated))}</time>
            {" · "}Escrito pela equipe do FloraClin
          </p>

          <section
            aria-labelledby="resposta-rapida"
            className="rounded-2xl border border-sage/20 bg-white p-6 md:p-8 mb-12"
          >
            <h2 id="resposta-rapida" className="text-xl md:text-2xl mb-3">
              Resposta rápida
            </h2>
            <div className="content-prose">{quickAnswer}</div>
          </section>

          <div className="content-prose">{children}</div>

          <section aria-labelledby="cta-floraclin" className="my-16 rounded-2xl bg-forest px-6 py-10 md:px-10 text-center">
            <h2 id="cta-floraclin" className="text-2xl md:text-3xl text-cream mb-3">
              {ctaTitle}
            </h2>
            <p className="text-cream/70 mb-8">{ctaText}</p>
            <SignupLink className="btn-primary bg-cream text-forest hover:bg-blush">
              Começar grátis
            </SignupLink>
          </section>

          {faqs.length > 0 && (
            <section aria-labelledby="perguntas-frequentes" className="mb-16">
              <h2 id="perguntas-frequentes" className="text-2xl md:text-3xl mb-6">
                Perguntas frequentes
              </h2>
              <div className="flex flex-col gap-3">
                {faqs.map((faq) => (
                  <details key={faq.question} className="group bg-white rounded-2xl border border-sage/10">
                    <summary className="flex items-center justify-between gap-4 px-6 py-5 cursor-pointer">
                      <span className="font-medium text-forest">{faq.question}</span>
                      <ChevronDown size={20} className="faq-chevron text-sage shrink-0" aria-hidden="true" />
                    </summary>
                    <p className="px-6 pb-5 -mt-1 text-charcoal/75 leading-relaxed">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {relatedPages.length > 0 && (
            <nav aria-labelledby="leia-tambem">
              <h2 id="leia-tambem" className="text-xl mb-4">
                Leia também
              </h2>
              <ul className="list-none m-0 p-0 grid gap-3 sm:grid-cols-2">
                {relatedPages.map((p) => (
                  <li key={p.path}>
                    <Link
                      href={p.path}
                      className="block h-full rounded-xl border border-sage/15 bg-white px-5 py-4 text-forest hover:border-sage no-underline"
                    >
                      {p.linkLabel ?? p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </article>
      </main>
      <Footer />
      {structuredData(path, faqs, article).map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
        />
      ))}
    </>
  );
}
