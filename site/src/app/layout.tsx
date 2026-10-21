import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Suspense } from "react";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { MetaPixel } from "@/components/meta-pixel";
import { StructuredData } from "@/components/structured-data";
import { metaPixelId } from "@/lib/marketing-attribution";
import { SITE_URL } from "@/lib/site-pages";
import "./globals.css";

// Domain ownership tags. Google's and Bing's render only when their env var is
// set on floraclin-site; Facebook's is a fixed token. The values are baked in
// at build time, so a redeploy is needed after changing them.
function searchVerification(): Metadata["verification"] {
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  return {
    ...(google ? { google } : {}),
    other: {
      "facebook-domain-verification": "yopa79on7t80wti0m5ff2jw1w3j02v",
      ...(bing ? { "msvalidate.01": bing } : {}),
    },
  };
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "FloraClin — Gestão para clínicas de HOF",
  description:
    "Agenda, prontuário, financeiro e procedimentos — tudo integrado em uma plataforma feita exclusivamente para Harmonização Orofacial.",
  keywords: [
    "harmonização orofacial",
    "gestão clínica HOF",
    "software para clínica de estética",
    "prontuário digital HOF",
    "diagrama facial",
    "agenda clínica",
    "CRM para clínica odontológica",
    "confirmação automática de consultas",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "FloraClin",
    title: "FloraClin — Gestão para clínicas de HOF",
    description:
      "Agenda, prontuário, financeiro e procedimentos — tudo integrado em uma plataforma feita exclusivamente para Harmonização Orofacial.",
    url: SITE_URL,
    type: "website",
    locale: "pt_BR",
  },
  twitter: {
    card: "summary_large_image",
  },
  verification: searchVerification(),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pixelId = metaPixelId();

  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Suspense fallback={null}>
          <MetaPixel pixelId={pixelId} />
        </Suspense>
        {children}
        <StructuredData />
        <Analytics />
        <CookieConsentBanner />
      </body>
    </html>
  );
}
