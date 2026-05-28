import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

// @sparticuz/chromium-min 149.0.0 → matching pack tar URL.
// Override via process.env.CHROMIUM_PACK_URL in production (e.g. S3).
const DEFAULT_CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar'

function getChromiumPackUrl(): string {
  return process.env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK_URL
}

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
`

/**
 * Renders a React element to a PDF Buffer using headless Chromium.
 *
 * Important: do NOT call this from inside an HTTP loop or fetch a separate
 * print URL. The print component is shared with the authenticated print page
 * and rendered server-side with react-dom/server here.
 */
export async function renderReactToPdf(
  tree: ReactElement,
  baseStyles: string = PRINT_BASE_CSS,
): Promise<Buffer> {
  const bodyMarkup = renderToStaticMarkup(tree)
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>${bodyMarkup}</body></html>`

  // Dynamic imports keep these heavy deps out of the cold-start critical path
  // for routes that never render PDFs.
  const [{ default: puppeteer }, chromiumModule] = await Promise.all([
    import('puppeteer-core'),
    import('@sparticuz/chromium-min'),
  ])
  const chromium = chromiumModule.default

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(getChromiumPackUrl()),
    headless: true,
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
