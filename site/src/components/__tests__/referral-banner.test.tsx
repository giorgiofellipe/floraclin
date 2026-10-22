import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReferralBanner } from '../referral-banner'

describe('ReferralBanner', () => {
  it('shows the exact copy and a CTA carrying the code', () => {
    const { container } = render(<ReferralBanner clinicName="Clínica Flor" code="MECA7K" />)
    expect(container.textContent).toContain(
      'Clínica Flor indicou o FloraClin para você: 14 dias grátis + 20% de desconto nos 2 primeiros meses.',
    )
    expect(screen.getByRole('link', { name: 'Começar teste grátis' })).toHaveAttribute(
      'href',
      'https://app.floraclin.com.br/signup?ref=MECA7K',
    )
  })

  it('shortens a long clinic name', () => {
    const name = 'Clínica de Harmonização Orofacial Doutora Maria Aparecida dos Santos'
    const { container } = render(<ReferralBanner clinicName={name} code="MECA7K" />)
    expect(container.textContent).not.toContain(name)
    expect(container.textContent).toContain('…')
  })
})
