import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FloraClin — Gestão para clínicas de HOF",
  description:
    "Agenda, prontuário, financeiro e procedimentos — tudo integrado em uma plataforma feita exclusivamente para Harmonização Orofacial.",
  openGraph: {
    title: "FloraClin — Gestão para clínicas de HOF",
    description:
      "Agenda, prontuário, financeiro e procedimentos — tudo integrado em uma plataforma feita exclusivamente para Harmonização Orofacial.",
    type: "website",
    locale: "pt_BR",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
