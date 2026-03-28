import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/tests/mocks/db'

// Mock auth
vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn().mockResolvedValue({
    userId: 'test-user-id',
    tenantId: 'test-tenant-id',
    role: 'owner',
    email: 'test@test.com',
    fullName: 'Test User',
  }),
  requireRole: vi.fn().mockResolvedValue({
    userId: 'test-user-id',
    tenantId: 'test-tenant-id',
    role: 'owner',
    email: 'test@test.com',
    fullName: 'Test User',
  }),
}))

// Mock audit
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}))

// Mock next/headers
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockImplementation((name: string) => {
      if (name === 'x-forwarded-for') return '192.168.1.1'
      if (name === 'user-agent') return 'Test Agent'
      return null
    }),
  }),
}))

// Mock consent queries
const mockAcceptConsent = vi.fn()
const mockCreateConsentTemplate = vi.fn()
const mockUpdateConsentTemplate = vi.fn()

vi.mock('@/db/queries/consent', () => ({
  listConsentTemplates: vi.fn(),
  createConsentTemplate: (...args: unknown[]) => mockCreateConsentTemplate(...args),
  updateConsentTemplate: (...args: unknown[]) => mockUpdateConsentTemplate(...args),
  acceptConsent: (...args: unknown[]) => mockAcceptConsent(...args),
  getConsentHistory: vi.fn(),
  getActiveConsentForType: vi.fn(),
  getConsentTemplateById: vi.fn(),
}))

import { createAuditLog } from '@/lib/audit'

describe('consent actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('acceptConsentAction', () => {
    it('creates immutable record with IP and user agent', async () => {
      const { acceptConsentAction } = await import('@/actions/consent')

      mockAcceptConsent.mockResolvedValue({
        id: 'acceptance-1',
        contentHash: 'abc123',
        contentSnapshot: 'Consent text...',
      })

      const result = await acceptConsentAction({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        consentTemplateId: '660e8400-e29b-41d4-a716-446655440000',
        acceptanceMethod: 'checkbox',
      })

      expect(result?.success).toBe(true)
      // Verify acceptConsent was called with IP/UA metadata
      expect(mockAcceptConsent).toHaveBeenCalledWith(
        'test-tenant-id',
        expect.objectContaining({
          patientId: '550e8400-e29b-41d4-a716-446655440000',
          consentTemplateId: '660e8400-e29b-41d4-a716-446655440000',
          acceptanceMethod: 'checkbox',
        }),
        expect.objectContaining({
          ipAddress: '192.168.1.1',
          userAgent: 'Test Agent',
        })
      )
      // Audit log should be created
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'consent_accepted',
          entityType: 'consent_acceptance',
          entityId: 'acceptance-1',
        })
      )
    })

    it('validates required fields', async () => {
      const { acceptConsentAction } = await import('@/actions/consent')

      const result = await acceptConsentAction({
        patientId: 'not-a-uuid',
        consentTemplateId: '660e8400-e29b-41d4-a716-446655440000',
        acceptanceMethod: 'checkbox',
      })

      expect(result?.fieldErrors).toBeDefined()
      expect(mockAcceptConsent).not.toHaveBeenCalled()
    })

    it('requires signature data when method is signature', async () => {
      const { acceptConsentAction } = await import('@/actions/consent')

      const result = await acceptConsentAction({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        consentTemplateId: '660e8400-e29b-41d4-a716-446655440000',
        acceptanceMethod: 'signature',
        // Missing signatureData
      })

      expect(result?.fieldErrors).toBeDefined()
      expect(mockAcceptConsent).not.toHaveBeenCalled()
    })

    it('accepts signature method with valid signature data', async () => {
      const { acceptConsentAction } = await import('@/actions/consent')

      mockAcceptConsent.mockResolvedValue({
        id: 'acceptance-2',
        contentHash: 'def456',
      })

      const result = await acceptConsentAction({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        consentTemplateId: '660e8400-e29b-41d4-a716-446655440000',
        acceptanceMethod: 'signature',
        signatureData: 'data:image/png;base64,iVBOR...',
      })

      expect(result?.success).toBe(true)
    })
  })

  describe('updateConsentTemplateAction', () => {
    it('creates new version on template update', async () => {
      const { updateConsentTemplateAction } = await import('@/actions/consent')

      mockUpdateConsentTemplate.mockResolvedValue({
        id: 'template-new',
        version: 2,
        type: 'general',
        title: 'Updated Title',
        content: 'Updated content for consent form.',
      })

      const formData = new FormData()
      formData.set('templateId', 'template-1')
      formData.set('title', 'Updated Title')
      formData.set('content', 'Updated content for consent form.')

      const result = await updateConsentTemplateAction(null, formData)

      expect(result?.success).toBe(true)
      // updateConsentTemplate internally deactivates old version and creates new one
      expect(mockUpdateConsentTemplate).toHaveBeenCalledWith(
        'test-tenant-id',
        'template-1',
        {
          title: 'Updated Title',
          content: 'Updated content for consent form.',
        }
      )
      // Audit log should record version change
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          entityType: 'consent_template',
          changes: expect.objectContaining({
            version: { old: 1, new: 2 },
          }),
        })
      )
    })

    it('rejects incomplete data', async () => {
      const { updateConsentTemplateAction } = await import('@/actions/consent')

      const formData = new FormData()
      // Missing templateId and content
      formData.set('title', 'Updated Title')

      const result = await updateConsentTemplateAction(null, formData)

      expect(result?.error).toBe('Dados incompletos')
      expect(mockUpdateConsentTemplate).not.toHaveBeenCalled()
    })
  })
})
