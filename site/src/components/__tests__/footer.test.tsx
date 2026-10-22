import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '../footer'
import { CONTENT_PAGES } from '@/lib/site-pages'

describe('Footer', () => {
  // Meta checks this visible line to approve the WhatsApp display name "FloraClin".
  it('shows the legal entity behind FloraClin', () => {
    render(<Footer />)
    expect(
      screen.getByText(
        'FloraClin é um produto da Bullcode Serviços em Tecnologia LTDA · CNPJ 27.435.275/0001-04 · Rio do Sul - SC',
      ),
    ).toBeInTheDocument()
  })
})

describe('Footer guide links', () => {
  // Internal links from every page (home included) to the guides and comparisons.
  it('links every guide and comparison page', () => {
    render(<Footer />)
    for (const page of CONTENT_PAGES) {
      expect(screen.getByRole('link', { name: page.linkLabel ?? page.title })).toHaveAttribute('href', page.path)
    }
  })
})
