// This module renders the print tree to static HTML before handing it to
// headless Chromium. `react-dom/server` is loaded dynamically inside the
// render call so Turbopack's static "you're shipping renderToString" warning
// (and the App Router's general aversion to top-level react-dom/server
// imports) don't fire. `server-only` is the belt-and-suspenders: any client
// component that transitively imports this file throws at build time
// instead of silently bundling Chromium + react-dom/server into the browser.
import 'server-only'
import React, { type ReactElement } from 'react'
import { buildFloraclinFooterTemplate } from './pdf-branding'
import { getAppUrl } from './app-url'

// @sparticuz/chromium-min 149.0.0 → matching pack tar URL.
// Override via process.env.CHROMIUM_PACK_URL in production (e.g. S3).
const DEFAULT_CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar'

function getChromiumPackUrl(): string {
  return process.env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK_URL
}

/**
 * Returns a system Chrome/Chromium binary path for local development. The
 * sparticuz pack is a Linux x86_64 ELF binary — on macOS / Windows it
 * fails to spawn with `errno -8 (ENOEXEC)`. In dev, prefer:
 *
 *   1. `PUPPETEER_EXECUTABLE_PATH` — explicit override, wins everywhere
 *   2. macOS: the default Google Chrome install
 *   3. Linux: a system `google-chrome` / `chromium` (resolved via PATH at
 *      spawn time; returning undefined lets puppeteer fall back to its
 *      own search)
 *
 * On Vercel / Lambda we keep using the sparticuz pack — those runtimes
 * are linux x86_64.
 */
function getLocalChromePath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  }
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  }
  return undefined
}

const USE_SPARTICUZ = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined

export const PRINT_BASE_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Times New Roman', Times, serif;
    line-height: 1.6;
    color: black;
    margin: 0;
    padding: 24px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    border-bottom: 1px solid #999;
    padding-bottom: 1rem;
  }
  header img { height: 64px; width: 64px; object-fit: contain; }
  .clinic-name { font-size: 18px; font-weight: 600; }
  .clinic-meta { font-size: 11px; color: #555; }
  h1 { font-size: 18px; margin: 1.5rem 0 0.5rem 0; }
  .meta-row { font-size: 12px; color: #444; margin-top: 0.25rem; }
  .body {
    white-space: pre-wrap;
    margin-top: 1.25rem;
    font-size: 14px;
  }
  .footer { margin-top: 4rem; text-align: center; }
  .footer img { height: 96px; max-width: 280px; object-fit: contain; }
  .footer .line { border-top: 1px solid black; margin: 0.25rem auto 0 auto; width: 280px; }
  .footer .name { margin-top: 0.5rem; font-weight: 500; font-size: 14px; }
  .footer .registry { font-size: 12px; color: #555; }
  .verification-footer {
    margin-top: 2rem;
    padding-top: 0.75rem;
    border-top: 1px solid #ddd;
    text-align: center;
    font-size: 10px;
    color: #888;
  }
`

export interface RenderReactToPdfOptions {
  /**
   * Raw HTML for Puppeteer's per-page footer (`page.pdf({ footerTemplate })`).
   * Defaults to the FloraClin brand line so every PDF gets it for free,
   * without every call site having to remember to pass one. Pass `''` to
   * suppress it entirely (still requires `displayHeaderFooter`, which this
   * function always sets once any footer is in play).
   */
  footerTemplate?: string
}

/**
 * Renders a React element to a PDF Buffer using headless Chromium.
 *
 * Important: do NOT call this from inside an HTTP loop or fetch a separate
 * print URL. The print component is shared with the authenticated print page
 * and rendered server-side with react-dom/server here.
 *
 * Every PDF gets a repeating per-page footer via Puppeteer's native
 * `footerTemplate` mechanism (see `page.pdf` below) — a plain React node
 * rendered into the body only ever appears once, wherever pagination lands
 * it, which is why a footer that must repeat on every page can't be a
 * regular part of `tree`.
 */
export async function renderReactToPdf(
  tree: ReactElement,
  baseStyles: string = PRINT_BASE_CSS,
  options: RenderReactToPdfOptions = {},
): Promise<Buffer> {
  // Dynamic imports keep these heavy deps (and react-dom/server) out of the
  // cold-start critical path for routes that never render PDFs, and prevent
  // Next/Turbopack from flagging this file as risky for client bundles.
  // On dev / non-Vercel hosts we don't need @sparticuz/chromium-min at all —
  // skip importing it so a missing pack URL doesn't break local runs.
  const importPromises: Array<Promise<unknown>> = [
    import('react-dom/server'),
    import('puppeteer-core'),
  ]
  if (USE_SPARTICUZ) importPromises.push(import('@sparticuz/chromium-min'))
  const [reactDomServer, puppeteerMod, chromiumMod] = (await Promise.all(importPromises)) as [
    typeof import('react-dom/server'),
    typeof import('puppeteer-core'),
    typeof import('@sparticuz/chromium-min') | undefined,
  ]
  const renderToStaticMarkup = reactDomServer.renderToStaticMarkup
  const puppeteer = puppeteerMod.default

  const bodyMarkup = renderToStaticMarkup(tree)
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>${bodyMarkup}</body></html>`

  // Decide which Chromium to launch with. Lambda/Vercel get the sparticuz
  // pack (Linux x86_64 binary downloaded once). Local dev gets the system
  // Chrome via PUPPETEER_EXECUTABLE_PATH or a platform-known path.
  const launchOptions: Parameters<typeof puppeteer.launch>[0] = USE_SPARTICUZ
    ? {
        args: chromiumMod!.default.args,
        executablePath: await chromiumMod!.default.executablePath(getChromiumPackUrl()),
        headless: true,
      }
    : {
        executablePath: getLocalChromePath(),
        headless: true,
      }
  const browser = await puppeteer.launch(launchOptions)

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const footerTemplate = options.footerTemplate ?? buildFloraclinFooterTemplate()
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
      // `displayHeaderFooter` is required for `footerTemplate` to take
      // effect at all. `headerTemplate` is left blank (Puppeteer's default
      // otherwise prints its own date/title/url/page-number header, which
      // we don't want) — the FloraClin brand mark on page 1 is instead part
      // of `tree` itself (`FloraclinBrandHeader` in `@/lib/pdf-branding`),
      // since that only needs to appear once, not repeat per page.
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate,
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

export function VerificationFooter({ code }: { code: string }): ReactElement {
  const appUrl = getAppUrl()
  return React.createElement(
    'div',
    { className: 'verification-footer' },
    `Documento assinado eletronicamente · Verifique: ${appUrl}/verify/${code}`,
  )
}
