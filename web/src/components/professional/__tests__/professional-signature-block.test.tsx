import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfessionalSignatureBlock } from '../professional-signature-block'

describe('ProfessionalSignatureBlock', () => {
  it('renders signature image, name, and registry line', () => {
    render(
      <ProfessionalSignatureBlock
        signatureDataUrl="data:image/png;base64,xxx"
        displayName="Dra. Joana Silva"
        registryLine="CRM-SP 123.456"
      />
    )
    expect(screen.getByAltText('Assinatura de Dra. Joana Silva')).toBeInTheDocument()
    expect(screen.getByText('Dra. Joana Silva')).toBeInTheDocument()
    expect(screen.getByText('CRM-SP 123.456')).toBeInTheDocument()
  })
})
