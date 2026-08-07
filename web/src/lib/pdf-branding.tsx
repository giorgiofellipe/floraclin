/**
 * FloraClin brand assets shared by every PDF/print document: the seven
 * table reports and the prontuário (`@/components/reports/*-pdf.tsx`), plus
 * the consent and clinical-document PDFs (`@/components/consent/print-consent`,
 * `@/components/clinical-documents/print-document`) — the latter two also
 * render on-screen on the "/imprimir" browser-print pages, which load the
 * full Tailwind bundle.
 *
 * Deliberately self-contained: every rule here is an inline `style` prop,
 * never a CSS class. `renderReactToPdf` (`@/lib/pdf`) hands Chromium a raw
 * HTML string with only `PRINT_BASE_CSS` + the document's own small
 * stylesheet loaded — no Tailwind — while the "/imprimir" pages load the
 * full app CSS. Inline styles are the only styling mechanism guaranteed to
 * render identically in both.
 *
 * No `'use client'` / `server-only` marker: this module is plain,
 * side-effect-free JSX, safe to import from server-only PDF routes, from
 * client-rendered print pages, and from tests without any extra mocking.
 */
import * as React from 'react'

// Inlined from web/public/brand/logo-symbol.svg ("forest" palette variant,
// #1C2B1E — the same dark green used elsewhere in these documents, e.g. the
// face-diagram tooltip background in `diagram-point.tsx`). Rendered as
// literal SVG markup rather than an `<img src="/brand/...">` reference:
// `renderReactToPdf` calls Chromium's `page.setContent(html)` with no base
// URL, so a root-relative path never resolves there, and reading the file
// off disk with `fs` at render time is not reliable on Vercel/Lambda — the
// Next.js file-tracer does not guarantee arbitrary `public/` assets ship
// inside the serverless function bundle. Inline SVG has zero network or
// filesystem dependency at render time, which makes it the one embedding
// that is reliable in every environment this renders in (dev, browser
// print, and headless Chromium on Vercel/Lambda alike).
const FLORACLIN_LOGOMARK_SVG = `<svg width="20" height="20" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="26" cy="16" rx="6" ry="12" stroke="#1C2B1E" stroke-width="1.4" transform="rotate(0 26 26)"/>
  <ellipse cx="26" cy="16" rx="6" ry="12" stroke="#1C2B1E" stroke-width="1.4" transform="rotate(60 26 26)"/>
  <ellipse cx="26" cy="16" rx="6" ry="12" stroke="#1C2B1E" stroke-width="1.4" transform="rotate(120 26 26)"/>
  <ellipse cx="26" cy="16" rx="6" ry="12" stroke="#1C2B1E" stroke-width="1.4" transform="rotate(180 26 26)"/>
  <ellipse cx="26" cy="16" rx="6" ry="12" stroke="#1C2B1E" stroke-width="1.4" transform="rotate(240 26 26)"/>
  <ellipse cx="26" cy="16" rx="6" ry="12" stroke="#1C2B1E" stroke-width="1.4" transform="rotate(300 26 26)"/>
  <circle cx="26" cy="26" r="3" fill="#1C2B1E"/>
</svg>`

export const FLORACLIN_FOOTER_TEXT = 'FloraClin | Gestão para clínicas de HOF | https://floraclin.com.br'

/**
 * Renders once, at the very top of the document's own content flow — which
 * is exactly what makes it a "first page" header rather than a repeating
 * one: `renderReactToPdf` sends a single static HTML string to Chromium, so
 * anything in the body's React tree appears exactly once, wherever
 * pagination happens to land it. A mark that must repeat on every page
 * needs the different mechanism below (`buildFloraclinFooterTemplate`,
 * wired through Puppeteer's `footerTemplate`, which Chromium re-renders per
 * page — a plain React node in the body cannot do that).
 */
export function FloraclinBrandHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
      <span
        style={{ display: 'inline-flex', width: '20px', height: '20px', flexShrink: 0 }}
        dangerouslySetInnerHTML={{ __html: FLORACLIN_LOGOMARK_SVG }}
      />
      <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.03em', color: '#1C2B1E' }}>
        FloraClin
      </span>
    </div>
  )
}

/**
 * Puppeteer's per-page footer template (see `page.pdf({ footerTemplate })`
 * in `@/lib/pdf`). This is NOT a React tree — Puppeteer renders it as raw
 * HTML in its own isolated frame, re-evaluated on every page, and only
 * inline styles take effect there (no external stylesheet, no
 * `PRINT_BASE_CSS`). `pageNumber` / `totalPages` are Puppeteer's own
 * recognized class names, substituted with the real values at render time.
 */
export function buildFloraclinFooterTemplate(): string {
  return `<div style="width:100%;font-family:'Times New Roman',Times,serif;font-size:8px;color:#888;text-align:center;padding:0 20mm;box-sizing:border-box;">${FLORACLIN_FOOTER_TEXT} &nbsp;·&nbsp; Página <span class="pageNumber"></span>/<span class="totalPages"></span></div>`
}
