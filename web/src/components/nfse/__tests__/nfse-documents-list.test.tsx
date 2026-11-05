import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen, within } from '@/tests/test-utils'
import type { NfseDocumentListItem } from '@/lib/nfse/types'
import { NfseDocumentsList } from '../nfse-documents-list'

let mockRole = 'owner'

vi.mock('@/components/layout/subscription-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/layout/subscription-access')>()
  return { ...actual, useSubscriptionAccess: () => ({ ...actual.useSubscriptionAccess(), role: mockRole }) }
})

const base: NfseDocumentListItem = {
  id: 'doc-1',
  paymentRecordId: 'pay-1',
  nfseNumber: '12',
  status: 'issued',
  cancelRequested: false,
  issuedAt: '2026-11-05T17:21:37.000Z',
  createdAt: '2026-11-05T17:20:00.000Z',
  competenceDate: '2026-11-02',
  value: 1300,
  patientId: 'patient-1',
  patientName: 'Maria Souza',
  errorMessage: null,
  retryable: false,
  emailSentAt: null,
  environment: 'production',
}

let fetchMock: ReturnType<typeof vi.fn>

function serve(documents: NfseDocumentListItem[]) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/nfse/documents')) {
      return Response.json({ data: documents, total: documents.length, page: 1, limit: 30, totalPages: 1 })
    }
    if (url.startsWith('/api/financial/patients')) return Response.json([])
    return new Promise<Response>(() => {})
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function openRowMenu() {
  const row = await screen.findByTestId('nfse-document-row')
  await userEvent.click(within(row).getByRole('button', { name: 'Ações da nota' }))
}

beforeEach(() => {
  mockRole = 'owner'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NfseDocumentsList', () => {
  it.each([
    { role: 'owner', status: 'issued', items: ['Ver PDF', 'Baixar XML', 'Reenviar email', 'Cancelar NFS-e'] },
    { role: 'receptionist', status: 'issued', items: ['Ver PDF', 'Baixar XML', 'Reenviar email'] },
    { role: 'owner', status: 'cancelled', items: ['Ver PDF', 'Baixar XML'] },
  ] as const)('offers $items on an $status note to the $role', async ({ role, status, items }) => {
    mockRole = role
    serve([{ ...base, status }])
    renderWithProviders(<NfseDocumentsList />)
    await openRowMenu()
    const offered = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(offered).toEqual(items)
  })

  it('offers nothing on a note Sefin is still processing', async () => {
    serve([{ ...base, status: 'processing', nfseNumber: null, issuedAt: null }])
    renderWithProviders(<NfseDocumentsList />)
    const row = await screen.findByTestId('nfse-document-row')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it("shows Sefin's message on a rejected note and retries it through the emit dialog", async () => {
    serve([{ ...base, status: 'failed', nfseNumber: null, issuedAt: null, retryable: true, errorMessage: 'E1235: Falha no esquema' }])
    renderWithProviders(<NfseDocumentsList />)
    expect(await screen.findByText('E1235: Falha no esquema')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/nfse?paymentRecordIds=pay-1', undefined)
  })

  it('hides the XML export from the reception', async () => {
    mockRole = 'receptionist'
    serve([base])
    renderWithProviders(<NfseDocumentsList />)
    await screen.findByTestId('nfse-document-row')
    expect(screen.queryByRole('button', { name: 'Exportar XML (ZIP)' })).not.toBeInTheDocument()
  })

  it('says when the period has no notes', async () => {
    serve([])
    renderWithProviders(<NfseDocumentsList />)
    expect(await screen.findByText('Nenhuma nota fiscal no período.')).toBeInTheDocument()
  })
})
