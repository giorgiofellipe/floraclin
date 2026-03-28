import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/tests/mocks/db'

// Mock auth
vi.mock('@/lib/auth', () => ({
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

// Mock financial queries
const mockCreateFinancialEntry = vi.fn()
const mockPayInstallment = vi.fn()

vi.mock('@/db/queries/financial', () => ({
  createFinancialEntry: (...args: unknown[]) => mockCreateFinancialEntry(...args),
  listFinancialEntries: vi.fn(),
  getFinancialEntry: vi.fn(),
  payInstallment: (...args: unknown[]) => mockPayInstallment(...args),
  getRevenueOverview: vi.fn(),
}))

import { requireRole } from '@/lib/auth'

describe('financial actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({
      userId: 'test-user-id',
      tenantId: 'test-tenant-id',
      role: 'owner',
      email: 'test@test.com',
      fullName: 'Test User',
    })
  })

  describe('createFinancialEntryAction', () => {
    it('validates installment count min (1)', async () => {
      const { createFinancialEntryAction } = await import('@/actions/financial')

      const formData = new FormData()
      formData.set('patientId', '550e8400-e29b-41d4-a716-446655440000')
      formData.set('description', 'Botox treatment')
      formData.set('totalAmount', '500')
      formData.set('installmentCount', '0') // Invalid: below minimum

      const result = await createFinancialEntryAction(null, formData)

      expect(result?.fieldErrors).toBeDefined()
      expect(mockCreateFinancialEntry).not.toHaveBeenCalled()
    })

    it('validates installment count max (12)', async () => {
      const { createFinancialEntryAction } = await import('@/actions/financial')

      const formData = new FormData()
      formData.set('patientId', '550e8400-e29b-41d4-a716-446655440000')
      formData.set('description', 'Botox treatment')
      formData.set('totalAmount', '500')
      formData.set('installmentCount', '13') // Invalid: above maximum

      const result = await createFinancialEntryAction(null, formData)

      expect(result?.fieldErrors).toBeDefined()
      expect(mockCreateFinancialEntry).not.toHaveBeenCalled()
    })

    it('accepts valid installment count within range', async () => {
      const { createFinancialEntryAction } = await import('@/actions/financial')

      mockCreateFinancialEntry.mockResolvedValue({ id: 'entry-1' })

      const formData = new FormData()
      formData.set('patientId', '550e8400-e29b-41d4-a716-446655440000')
      formData.set('description', 'Botox treatment')
      formData.set('totalAmount', '500')
      formData.set('installmentCount', '6')

      const result = await createFinancialEntryAction(null, formData)

      expect(result?.success).toBe(true)
      expect(mockCreateFinancialEntry).toHaveBeenCalledWith(
        'test-tenant-id',
        'test-user-id',
        expect.objectContaining({
          installmentCount: 6,
          totalAmount: 500,
        })
      )
    })

    it('rejects negative total amount', async () => {
      const { createFinancialEntryAction } = await import('@/actions/financial')

      const formData = new FormData()
      formData.set('patientId', '550e8400-e29b-41d4-a716-446655440000')
      formData.set('description', 'Botox treatment')
      formData.set('totalAmount', '-100')
      formData.set('installmentCount', '1')

      const result = await createFinancialEntryAction(null, formData)

      expect(result?.fieldErrors).toBeDefined()
      expect(mockCreateFinancialEntry).not.toHaveBeenCalled()
    })
  })

  describe('payInstallmentAction', () => {
    it('validates payment method - accepts valid methods', async () => {
      const { payInstallmentAction } = await import('@/actions/financial')

      mockPayInstallment.mockResolvedValue({ id: 'inst-1', status: 'paid' })

      const result = await payInstallmentAction(
        '550e8400-e29b-41d4-a716-446655440000',
        'pix'
      )

      expect(result?.success).toBe(true)
    })

    it('validates payment method - rejects invalid methods', async () => {
      const { payInstallmentAction } = await import('@/actions/financial')

      const result = await payInstallmentAction(
        '550e8400-e29b-41d4-a716-446655440000',
        'bitcoin' as never
      )

      expect(result?.fieldErrors).toBeDefined()
      expect(mockPayInstallment).not.toHaveBeenCalled()
    })

    it('validates installmentId must be UUID', async () => {
      const { payInstallmentAction } = await import('@/actions/financial')

      const result = await payInstallmentAction('not-a-uuid', 'pix')

      expect(result?.fieldErrors).toBeDefined()
      expect(mockPayInstallment).not.toHaveBeenCalled()
    })
  })
})
