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

// Mock patient queries
const mockCreatePatient = vi.fn()
const mockUpdatePatient = vi.fn()
const mockDeletePatient = vi.fn()
const mockGetPatient = vi.fn()
const mockListPatients = vi.fn()

vi.mock('@/db/queries/patients', () => ({
  createPatient: (...args: unknown[]) => mockCreatePatient(...args),
  updatePatient: (...args: unknown[]) => mockUpdatePatient(...args),
  deletePatient: (...args: unknown[]) => mockDeletePatient(...args),
  getPatient: (...args: unknown[]) => mockGetPatient(...args),
  listPatients: (...args: unknown[]) => mockListPatients(...args),
}))

import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'

describe('patient actions', () => {
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

  describe('createPatientAction', () => {
    it('validates required fields and creates patient', async () => {
      const { createPatientAction } = await import('@/actions/patients')

      mockCreatePatient.mockResolvedValue({ id: 'new-patient-id' })

      const result = await createPatientAction({
        fullName: 'Maria Silva',
        phone: '11999999999',
      })

      expect(result).toEqual({ success: true })
      expect(mockCreatePatient).toHaveBeenCalledWith(
        'test-tenant-id',
        expect.objectContaining({
          fullName: 'Maria Silva',
          phone: '11999999999',
        })
      )
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          entityType: 'patient',
          entityId: 'new-patient-id',
        })
      )
    })

    it('rejects with invalid data - missing fullName', async () => {
      const { createPatientAction } = await import('@/actions/patients')

      const result = await createPatientAction({
        fullName: '',
        phone: '11999999999',
      })

      expect(result?.error).toBe('Dados inválidos')
      expect(result?.fieldErrors).toBeDefined()
      expect(mockCreatePatient).not.toHaveBeenCalled()
    })

    it('rejects with invalid data - missing phone', async () => {
      const { createPatientAction } = await import('@/actions/patients')

      const result = await createPatientAction({
        fullName: 'Maria Silva',
        phone: '',
      })

      expect(result?.error).toBe('Dados inválidos')
      expect(result?.fieldErrors).toBeDefined()
      expect(mockCreatePatient).not.toHaveBeenCalled()
    })

    it('returns permission error when role is unauthorized', async () => {
      const { createPatientAction } = await import('@/actions/patients')

      vi.mocked(requireRole).mockRejectedValue(
        new Error('Forbidden: insufficient permissions')
      )

      const result = await createPatientAction({
        fullName: 'Maria Silva',
        phone: '11999999999',
      })

      expect(result?.error).toBe('Sem permissão para criar pacientes')
    })
  })

  describe('deletePatientAction', () => {
    it('calls soft delete (not hard delete) via deletePatient query', async () => {
      const { deletePatientAction } = await import('@/actions/patients')

      // deletePatient in queries/patients.ts does UPDATE SET deletedAt, not DELETE
      mockDeletePatient.mockResolvedValue({ id: 'patient-1', deletedAt: new Date() })

      const result = await deletePatientAction('patient-1')

      expect(result).toEqual({ success: true })
      // Verify that deletePatient (which is a soft delete) was called
      expect(mockDeletePatient).toHaveBeenCalledWith('test-tenant-id', 'patient-1')
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete',
          entityType: 'patient',
          entityId: 'patient-1',
        })
      )
    })

    it('returns error when patient is not found', async () => {
      const { deletePatientAction } = await import('@/actions/patients')

      mockDeletePatient.mockResolvedValue(null)

      const result = await deletePatientAction('nonexistent')

      expect(result?.error).toBe('Paciente não encontrado')
    })
  })
})
