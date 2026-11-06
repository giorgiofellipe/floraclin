import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { NfseDocumentSummary } from '@/lib/nfse/types'
import { NfsePaymentChip } from '../nfse-payment-chip'

const issued: NfseDocumentSummary = {
  id: 'doc-1',
  paymentRecordId: 'pay-1',
  status: 'issued',
  errorCode: null,
  errorMessage: null,
  nfseNumber: '12',
  competenceDate: '2026-10-30',
  emailSentAt: null,
  cancelRequested: false,
  retryable: false,
}

function renderChip(nfse: NfseDocumentSummary | null, { canCancel = false, onEmit = () => {} } = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NfsePaymentChip payment={{ id: 'pay-1', nfse }} canEmit canCancel={canCancel} onEmit={onEmit} />
    </QueryClientProvider>,
  )
}

async function openMenu(nfse: NfseDocumentSummary, canCancel: boolean) {
  renderChip(nfse, { canCancel })
  await userEvent.click(screen.getByTestId('nfse-menu'))
}

describe('NfsePaymentChip', () => {
  it.each([
    { name: 'no note yet', nfse: null },
    { name: 'a cancelled note', nfse: { ...issued, status: 'cancelled' as const } },
  ])('shows "Emitir NFS-e" as a button in the row for a payment with $name', async ({ nfse }) => {
    const onEmit = vi.fn()
    renderChip(nfse, { onEmit })
    await userEvent.click(screen.getByRole('button', { name: 'Emitir NFS-e' }))
    expect(onEmit).toHaveBeenCalledWith('pay-1')
  })

  it('keeps "Emitir NFS-e" out of the menu of a cancelled note', async () => {
    await openMenu({ ...issued, status: 'cancelled' }, true)
    await screen.findByText('Ver PDF')
    expect(screen.queryByRole('menuitem', { name: 'Emitir NFS-e' })).not.toBeInTheDocument()
  })

  it.each([
    { canCancel: false, visible: false },
    { canCancel: true, visible: true },
  ])('shows "Cancelar NFS-e" only to a role that can cancel (canCancel=$canCancel)', async ({ canCancel, visible }) => {
    await openMenu(issued, canCancel)
    expect(await screen.findByText('Ver PDF')).toBeInTheDocument()
    expect(screen.queryByText('Cancelar NFS-e') !== null).toBe(visible)
  })

  it('keeps the PDF and XML of a cancelled note downloadable', async () => {
    await openMenu({ ...issued, status: 'cancelled' }, true)
    expect(await screen.findByText('Ver PDF')).toBeInTheDocument()
    expect(screen.getByText('Baixar XML')).toBeInTheDocument()
    expect(screen.queryByText('Reenviar email')).not.toBeInTheDocument()
  })

  it('lets a role that can cancel retry a pending cancellation, opening the cancel dialog', async () => {
    await openMenu({ ...issued, cancelRequested: true }, true)
    await userEvent.click(await screen.findByText('Tentar cancelar de novo'))
    expect(await screen.findByText('Justificativa')).toBeInTheDocument()
  })

  it('hides the cancellation retry from a role that cannot cancel', async () => {
    await openMenu({ ...issued, cancelRequested: true }, false)
    await screen.findByText('Ver PDF')
    expect(screen.queryByText('Tentar cancelar de novo')).not.toBeInTheDocument()
  })
})
