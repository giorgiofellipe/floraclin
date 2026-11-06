import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChargeRowMenu, ledgerHrefFor, type ChargeRowMenuEntry } from '../charge-row-menu'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/financeiro',
  useSearchParams: () => new URLSearchParams(),
}))

const pending: ChargeRowMenuEntry = {
  id: 'e1',
  patientId: 'p1',
  status: 'pending',
  // 23:30 BRT on Oct 31 is already Nov 1 in UTC: the link must keep the BR day.
  createdAt: '2026-11-01T02:30:00.000Z',
  pendingInstallmentIds: ['i1', 'i2'],
}

async function openMenu(entry: ChargeRowMenuEntry) {
  const onDialog = vi.fn()
  const onRenegotiate = vi.fn()
  render(<ChargeRowMenu entry={entry} onDialog={onDialog} onRenegotiate={onRenegotiate} />)
  await userEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
  await screen.findAllByRole('menuitem')
  return { onDialog, onRenegotiate }
}

const offered = () => screen.getAllByRole('menuitem').map((item) => item.textContent)

describe('ChargeRowMenu', () => {
  it('offers every bulk action for an open charge, plus the Extrato', async () => {
    const { onDialog, onRenegotiate } = await openMenu(pending)

    expect(offered()).toEqual(['Registrar pagamento', 'Renegociar', 'Cancelar', 'Ver no extrato'])

    await userEvent.click(screen.getByRole('menuitem', { name: 'Registrar pagamento' }))
    expect(onDialog).toHaveBeenCalledWith('pay')

    await userEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Renegociar' }))
    expect(onRenegotiate).toHaveBeenCalled()
  })

  it('offers Reativar instead of Cancelar on a cancelled charge, and says why Renegociar is off', async () => {
    const { onRenegotiate } = await openMenu({ ...pending, status: 'cancelled', pendingInstallmentIds: [] })

    expect(offered()).toEqual(['RenegociarCobrança cancelada', 'Reativar', 'Ver no extrato'])
    const renegotiate = screen.getByRole('menuitem', { name: /Renegociar/ })
    expect(renegotiate).toHaveAttribute('aria-disabled', 'true')
    expect(renegotiate).toHaveTextContent('Cobrança cancelada')

    await userEvent.click(renegotiate)
    expect(onRenegotiate).not.toHaveBeenCalled()
  })

  it('leaves Registrar pagamento out of a paid charge', async () => {
    await openMenu({ ...pending, status: 'paid', pendingInstallmentIds: [] })

    expect(screen.queryByRole('menuitem', { name: 'Registrar pagamento' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Renegociar/ })).toHaveTextContent('Cobrança já paga')
  })

  it('links to the Extrato filtered to the patient from the BR day the charge was created', async () => {
    await openMenu(pending)

    expect(screen.getByRole('menuitem', { name: 'Ver no extrato' })).toHaveAttribute(
      'href',
      '/financeiro?tab=ledger&patientId=p1&dateFrom=2026-10-31',
    )
    expect(ledgerHrefFor(pending)).toBe('/financeiro?tab=ledger&patientId=p1&dateFrom=2026-10-31')
  })
})
