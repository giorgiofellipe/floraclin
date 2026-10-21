import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '../footer'

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
