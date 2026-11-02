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

async function openMenu(canCancel: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NfsePaymentChip payment={{ id: 'pay-1', nfse: issued } as never} canEmit canCancel={canCancel} onEmit={() => {}} />
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button'))
}

describe('NfsePaymentChip', () => {
  it('hides "Cancelar NFS-e" from a role that cannot cancel', async () => {
    await openMenu(false)
    expect(await screen.findByText('Ver PDF')).toBeInTheDocument()
    expect(screen.queryByText('Cancelar NFS-e')).not.toBeInTheDocument()
  })

  it('shows "Cancelar NFS-e" to a role that can cancel', async () => {
    await openMenu(true)
    expect(await screen.findByText('Cancelar NFS-e')).toBeInTheDocument()
  })
})
