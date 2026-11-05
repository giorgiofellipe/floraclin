import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { NfseIntake } from '@/types'
import { NfsePromptProvider, useNfsePrompt } from '../nfse-prompt-provider'

function PayButton({ nfse, onPaid }: { nfse: NfseIntake; onPaid: () => void }) {
  const { promptAfterPayment } = useNfsePrompt()
  return (
    <button
      onClick={() => {
        promptAfterPayment(nfse)
        onPaid()
      }}
    >
      Pagar
    </button>
  )
}

// Unmounts right after paying, like a filtered entry leaving the list.
function PayingScreen({ nfse }: { nfse: NfseIntake }) {
  const [paid, setPaid] = useState(false)
  return paid ? null : <PayButton nfse={nfse} onPaid={() => setPaid(true)} />
}

function renderPayingScreen(nfse: NfseIntake) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NfsePromptProvider>
        <PayingScreen nfse={nfse} />
      </NfsePromptProvider>
    </QueryClientProvider>,
  )
  return fetchMock
}

function previewIds(fetchMock: ReturnType<typeof renderPayingScreen>) {
  const url = String(fetchMock.mock.calls.find(([u]) => String(u).startsWith('/api/nfse?'))?.[0] ?? '')
  return new URLSearchParams(url.split('?')[1]).get('paymentRecordIds')?.split(',') ?? []
}

describe('NfsePromptProvider', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the emit dialog open after the screen that took the payment unmounts', async () => {
    renderPayingScreen({ mode: 'ask', documentIds: [], promptPaymentRecordIds: ['pay-1'] })

    await userEvent.click(screen.getByText('Pagar'))

    expect(await screen.findByText('Confira os dados antes de emitir a nota fiscal.')).toBeInTheDocument()
    expect(screen.queryByText('Pagar')).not.toBeInTheDocument()
  })

  it('opens nothing when the payment needs no prompt', async () => {
    const fetchMock = renderPayingScreen({ mode: 'always', documentIds: ['doc-1'], promptPaymentRecordIds: [] })

    await userEvent.click(screen.getByText('Pagar'))

    expect(screen.queryByText('Confira os dados antes de emitir a nota fiscal.')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens the first 20 payments of a bulk payment and says where to emit the rest', async () => {
    const ids = Array.from({ length: 23 }, (_, i) => `pay-${i}`)
    const info = vi.spyOn(toast, 'info')
    const fetchMock = renderPayingScreen({ mode: 'ask', documentIds: [], promptPaymentRecordIds: ids })

    await userEvent.click(screen.getByText('Pagar'))

    await screen.findByText('Confira os dados antes de emitir a nota fiscal.')
    expect(previewIds(fetchMock)).toEqual(ids.slice(0, 20))
    expect(info).toHaveBeenCalledWith('A NFS-e dos outros 3 pagamentos pode ser emitida na tabela de parcelas.')
  })
})
