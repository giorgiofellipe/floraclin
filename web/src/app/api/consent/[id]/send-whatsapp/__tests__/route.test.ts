import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth-config', () => ({ auth: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { select: vi.fn() } }))
vi.mock('@/db/queries/consent', () => ({ getConsentAcceptanceWithContext: vi.fn() }))
vi.mock('@/db/queries/consent-signing-tokens', () => ({ getRecentlyUsedSigningToken: vi.fn() }))
vi.mock('@/lib/plans', () => ({ isSubscriptionActive: vi.fn() }))
vi.mock('@/lib/pdf', () => ({ renderReactToPdf: vi.fn(), PRINT_BASE_CSS: '' }))
vi.mock('@/lib/logo', () => ({ fetchLogoDataUri: vi.fn() }))
vi.mock('@/lib/storage', () => ({ uploadPdfBuffer: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ sendOrEnqueueDocument: vi.fn() }))
vi.mock('@/components/consent/print-consent', () => ({ PrintConsent: () => null }))

import { auth } from '@/lib/auth-config'
import { db } from '@/db/client'
import { getConsentAcceptanceWithContext } from '@/db/queries/consent'
import { getRecentlyUsedSigningToken } from '@/db/queries/consent-signing-tokens'
import { isSubscriptionActive } from '@/lib/plans'
import { renderReactToPdf } from '@/lib/pdf'
import { fetchLogoDataUri } from '@/lib/logo'
import { uploadPdfBuffer } from '@/lib/storage'
import { sendOrEnqueueDocument } from '@/lib/whatsapp'
import { POST } from '../route'

const ACCEPTANCE_ID = 'acc-1'

function mockMembershipRow(row: { tenantId: string } | undefined) {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'innerJoin', 'where']) chain[m] = vi.fn(() => chain)
  chain.limit = vi.fn(async () => (row ? [row] : []))
  vi.mocked(db.select).mockReturnValue(chain as never)
}

function post(query = '') {
  return POST(
    new NextRequest(`http://localhost/api/consent/${ACCEPTANCE_ID}/send-whatsapp${query}`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: ACCEPTANCE_ID }) },
  )
}

describe('POST /api/consent/[id]/send-whatsapp', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)
    vi.mocked(getConsentAcceptanceWithContext).mockResolvedValue({
      patientId: 'patient-1',
      patientName: 'Maria Silva',
      patientPhone: '11999990000',
      templateTitle: 'Termo de Botox',
      tenantLogoUrl: null,
    } as never)
    vi.mocked(fetchLogoDataUri).mockResolvedValue(null as never)
    vi.mocked(renderReactToPdf).mockResolvedValue(new Uint8Array([1]) as never)
    vi.mocked(uploadPdfBuffer).mockResolvedValue({ url: 'https://x/y.pdf', path: 'termos/y.pdf' } as never)
    vi.mocked(sendOrEnqueueDocument).mockResolvedValue({} as never)
  })

  it('attributes the send to the session user', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockMembershipRow({ tenantId: 'tenant-1' })

    const res = await post()

    expect(res.status).toBe(200)
    expect(sendOrEnqueueDocument).toHaveBeenCalledWith(
      'tenant-1',
      {
        actor: { type: 'user', userId: 'user-1' },
        recipient: { patientId: 'patient-1', name: 'Maria Silva' },
        documentLabel: 'Termo de Botox',
      },
      expect.any(String),
      'Maria',
      'https://x/y.pdf',
      expect.any(String),
      expect.any(String),
      'termos/y.pdf',
    )
  })

  it('attributes a signing-token send without a session to the patient', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    vi.mocked(getRecentlyUsedSigningToken).mockResolvedValue({ tenantId: 'tenant-1' } as never)
    mockMembershipRow({ tenantId: 'tenant-1' })

    const res = await post('?token=abc')

    expect(res.status).toBe(200)
    expect(sendOrEnqueueDocument).toHaveBeenCalledWith(
      'tenant-1',
      {
        actor: { type: 'patient' },
        recipient: { patientId: 'patient-1', name: 'Maria Silva' },
        documentLabel: 'Termo de Botox',
      },
      expect.any(String),
      'Maria',
      'https://x/y.pdf',
      expect.any(String),
      expect.any(String),
      'termos/y.pdf',
    )
  })
})
