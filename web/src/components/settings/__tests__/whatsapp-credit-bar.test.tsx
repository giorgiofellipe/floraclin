import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WhatsAppCreditBar } from '../whatsapp-credit-bar'

// Credit periods end at BR midnight on the 1st: 2026-12-01T03:00Z.
const PERIOD_END = '2026-12-01T03:00:00.000Z'

describe('WhatsAppCreditBar', () => {
  it('explains a plan without credits and links to the plans instead of showing "0 de 0"', () => {
    render(<WhatsAppCreditBar used={0} total={0} periodEnd={PERIOD_END} />)

    expect(screen.getByText('Seu plano não inclui créditos de WhatsApp')).toBeInTheDocument()
    expect(screen.queryByText(/0 de 0/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver planos/i })).toHaveAttribute('href', '/configuracoes?tab=assinatura')
  })

  it('dates the credits to the trial end when the trial ends before the credit period', () => {
    render(<WhatsAppCreditBar used={3} total={50} periodEnd={PERIOD_END} trialEnd="2026-11-28T15:00:00.000Z" />)

    expect(screen.getByText('Válidos até o fim do teste, em 28/11')).toBeInTheDocument()
    expect(screen.queryByText(/Renovam/)).not.toBeInTheDocument()
  })

  it('names the BR renewal day of a paid period', () => {
    render(<WhatsAppCreditBar used={3} total={300} periodEnd={PERIOD_END} />)

    expect(screen.getByText('Renovam em 01/12')).toBeInTheDocument()
  })

  it('points the exhausted warning at the plans tab', () => {
    render(<WhatsAppCreditBar used={300} total={300} periodEnd={PERIOD_END} />)

    expect(screen.getByRole('link', { name: /ver planos/i })).toHaveAttribute('href', '/configuracoes?tab=assinatura')
  })
})
