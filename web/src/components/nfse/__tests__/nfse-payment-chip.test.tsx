import { describe, expect, it } from 'vitest'
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

async function openMenu(nfse: NfseDocumentSummary, canCancel: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NfsePaymentChip payment={{ id: 'pay-1', nfse }} canEmit canCancel={canCancel} onEmit={() => {}} />
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button'))
}

describe('NfsePaymentChip', () => {
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
