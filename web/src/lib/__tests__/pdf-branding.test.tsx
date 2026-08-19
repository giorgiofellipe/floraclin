import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FLORACLIN_FOOTER_TEXT, FloraclinBrandHeader, buildFloraclinFooterTemplate } from '../pdf-branding'

describe('FloraclinBrandHeader', () => {
  it('renders the FloraClin name', () => {
    render(<FloraclinBrandHeader />)
    expect(screen.getByText('FloraClin')).toBeInTheDocument()
  })

  it('renders the brand mark as inline SVG, not an <img> reference', () => {
    const { container } = render(<FloraclinBrandHeader />)
    // Inline SVG has zero network/filesystem dependency at PDF-render time
    // (see the rationale in `pdf-branding.tsx`); an <img src> would silently
    // fail to load under `renderReactToPdf`'s base-URL-less `page.setContent`.
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })
})

describe('buildFloraclinFooterTemplate', () => {
  it('contains the required footer text', () => {
    expect(buildFloraclinFooterTemplate()).toContain(FLORACLIN_FOOTER_TEXT)
  })

  it('contains the exact required copy', () => {
    expect(FLORACLIN_FOOTER_TEXT).toBe('FloraClin | Gestão para clínicas de HOF | https://floraclin.com.br')
  })

  it('includes Puppeteer page-number tokens for a per-page footer', () => {
    const template = buildFloraclinFooterTemplate()
    expect(template).toContain('class="pageNumber"')
    expect(template).toContain('class="totalPages"')
  })
})
