import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EmitNfseDialog } from '../emit-nfse-dialog'

function mockPreview(competenceIsPastMonth: boolean) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        patients: [
          {
            patientId: 'p1',
            patientName: 'Maria',
            paymentRecordIds: ['pay-1'],
            total: 500,
            missing: [],
            email: 'maria@example.com',
            canEditTaker: true,
            current: null,
          },
        ],
        defaultCompetence: '2026-09-30',
        competenceIsPastMonth,
        settings: { emailPatient: true },
      },
    }),
  } as Response)
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <EmitNfseDialog paymentRecordIds={['pay-1']} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe('EmitNfseDialog', () => {
  afterEach(() => vi.restoreAllMocks())


  it('offers the service date and today when the competence is a past month, showing the service day unshifted', async () => {
    mockPreview(true)
    renderDialog()

    expect(await screen.findByText('Data do serviço (30/09/2026)')).toBeInTheDocument()
    expect(screen.getByText(/^Hoje \(/)).toBeInTheDocument()
  })

  it('hides the competence choice when the service is in the current month', async () => {
    mockPreview(false)
    renderDialog()

    await screen.findByText('Maria: R$ 500,00')
    expect(screen.queryByText(/^Data do serviço/)).not.toBeInTheDocument()
  })
})
