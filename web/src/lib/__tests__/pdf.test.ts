import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'

// `pdf.ts` starts with `import 'server-only'`, which throws unconditionally
// when resolved outside a Next.js server-component bundle (its `exports`
// map only swaps in the harmless no-op build under the `react-server`
// condition, which Vitest doesn't set) — see the working note in
// `src/lib/__tests__/storage.test.ts` for the same pattern. Mock it away so
// importing the real module doesn't trip that guard.
vi.mock('server-only', () => ({}))

// Stand in for headless Chromium: capture what `page.pdf(...)` gets called
// with instead of actually spawning a browser. `vi.hoisted` is required
// because `vi.mock` factories run before this file's own top-level const
// declarations.
const { launchMock, pdfMock, setContentMock } = vi.hoisted(() => {
  const pdfMock = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
  const setContentMock = vi.fn().mockResolvedValue(undefined)
  const page = { setContent: setContentMock, pdf: pdfMock }
  const launchMock = vi.fn().mockResolvedValue({
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  })
  return { launchMock, pdfMock, setContentMock }
})

vi.mock('puppeteer-core', () => ({ default: { launch: launchMock } }))

import { renderReactToPdf, PRINT_BASE_CSS } from '../pdf'
import { FLORACLIN_FOOTER_TEXT } from '../pdf-branding'

beforeEach(() => {
  launchMock.mockClear()
  pdfMock.mockClear()
  setContentMock.mockClear()
})

describe('renderReactToPdf', () => {
  it('enables a repeating per-page footer with the FloraClin brand line by default', async () => {
    await renderReactToPdf(React.createElement('div', null, 'conteúdo'), PRINT_BASE_CSS)

    expect(pdfMock).toHaveBeenCalledTimes(1)
    const pdfOptions = pdfMock.mock.calls[0][0]
    expect(pdfOptions.displayHeaderFooter).toBe(true)
    expect(pdfOptions.footerTemplate).toContain(FLORACLIN_FOOTER_TEXT)
    // The header stays blank — Puppeteer's own default header (date/title/
    // url/page-number) is not what we want; the brand mark on page 1 is
    // part of the React tree itself, not this per-page mechanism.
    expect(pdfOptions.headerTemplate).not.toContain(FLORACLIN_FOOTER_TEXT)
  })

  it('lets a caller override the footer template', async () => {
    await renderReactToPdf(React.createElement('div', null, 'x'), PRINT_BASE_CSS, {
      footerTemplate: '<div>custom footer</div>',
    })

    const pdfOptions = pdfMock.mock.calls[0][0]
    expect(pdfOptions.footerTemplate).toBe('<div>custom footer</div>')
  })

  it('returns the PDF bytes from page.pdf as a Buffer', async () => {
    const result = await renderReactToPdf(React.createElement('div', null, 'x'), PRINT_BASE_CSS)
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(Array.from(result)).toEqual([1, 2, 3])
  })
})
