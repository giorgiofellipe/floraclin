import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

// The paying screen goes away right after the payment, like a filtered entry
// leaving the list or a form closing.
function PayingScreen({ nfse }: { nfse: NfseIntake }) {
  const [paid, setPaid] = useState(false)
  return paid ? null : <PayButton nfse={nfse} onPaid={() => setPaid(true)} />
}

function renderPayingScreen(nfse: NfseIntake) {
  vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NfsePromptProvider>
        <PayingScreen nfse={nfse} />
      </NfsePromptProvider>
    </QueryClientProvider>,
  )
}

describe('NfsePromptProvider', () => {
  it('keeps the emit dialog open after the screen that took the payment unmounts', async () => {
    renderPayingScreen({ mode: 'ask', documentIds: [], promptPaymentRecordIds: ['pay-1'] })

    await userEvent.click(screen.getByText('Pagar'))

    expect(await screen.findByText('Confira os dados antes de emitir a nota fiscal.')).toBeInTheDocument()
    expect(screen.queryByText('Pagar')).not.toBeInTheDocument()
  })

  it('opens nothing when the payment needs no prompt', async () => {
    renderPayingScreen({ mode: 'always', documentIds: ['doc-1'], promptPaymentRecordIds: [] })

    await userEvent.click(screen.getByText('Pagar'))

    expect(screen.queryByText('Confira os dados antes de emitir a nota fiscal.')).not.toBeInTheDocument()
  })
})
