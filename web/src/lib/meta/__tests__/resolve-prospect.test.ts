import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProspectByPatientIdMock = vi.fn()
const getProspectByPhoneMock = vi.fn()
const getPatientMock = vi.fn()

vi.mock('@/db/queries/prospects', () => ({
  getProspectByPatientId: (...args: unknown[]) => getProspectByPatientIdMock(...args),
  getProspectByPhone: (...args: unknown[]) => getProspectByPhoneMock(...args),
}))

vi.mock('@/db/queries/patients', () => ({
  getPatient: (...args: unknown[]) => getPatientMock(...args),
}))

const TENANT = 'tenant-1'

describe('resolveProspectForPatient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves via the patient id first', async () => {
    const { resolveProspectForPatient } = await import('../resolve-prospect')
    getProspectByPatientIdMock.mockResolvedValue({ id: 'prospect-1' })

    const result = await resolveProspectForPatient(TENANT, { patientId: 'patient-1' })

    expect(result).toEqual({ id: 'prospect-1' })
    expect(getProspectByPatientIdMock).toHaveBeenCalledWith(TENANT, 'patient-1')
    expect(getPatientMock).not.toHaveBeenCalled()
    expect(getProspectByPhoneMock).not.toHaveBeenCalled()
  })

  it('falls back to the patient own phone when no prospect is linked by patient id', async () => {
    const { resolveProspectForPatient } = await import('../resolve-prospect')
    getProspectByPatientIdMock.mockResolvedValue(null)
    getPatientMock.mockResolvedValue({ id: 'patient-1', phone: '5547988443635' })
    getProspectByPhoneMock.mockResolvedValue({ id: 'prospect-2' })

    const result = await resolveProspectForPatient(TENANT, { patientId: 'patient-1' })

    expect(result).toEqual({ id: 'prospect-2' })
    expect(getPatientMock).toHaveBeenCalledWith(TENANT, 'patient-1')
    expect(getProspectByPhoneMock).toHaveBeenCalledWith(TENANT, '5547988443635')
  })

  it('falls back to the supplied phone when the patient has none and no prospect matched by patient id', async () => {
    const { resolveProspectForPatient } = await import('../resolve-prospect')
    getProspectByPatientIdMock.mockResolvedValue(null)
    getPatientMock.mockResolvedValue({ id: 'patient-1', phone: null })
    getProspectByPhoneMock.mockResolvedValue({ id: 'prospect-3' })

    const result = await resolveProspectForPatient(TENANT, {
      patientId: 'patient-1',
      phone: '5547988443635',
    })

    expect(result).toEqual({ id: 'prospect-3' })
    expect(getProspectByPhoneMock).toHaveBeenCalledWith(TENANT, '5547988443635')
  })

  it('resolves by the supplied phone alone when no patient id is given', async () => {
    const { resolveProspectForPatient } = await import('../resolve-prospect')
    getProspectByPhoneMock.mockResolvedValue({ id: 'prospect-4' })

    const result = await resolveProspectForPatient(TENANT, { phone: '5547988443635' })

    expect(result).toEqual({ id: 'prospect-4' })
    expect(getProspectByPatientIdMock).not.toHaveBeenCalled()
    expect(getPatientMock).not.toHaveBeenCalled()
    expect(getProspectByPhoneMock).toHaveBeenCalledWith(TENANT, '5547988443635')
  })

  it('returns null when nothing matches through the whole chain', async () => {
    const { resolveProspectForPatient } = await import('../resolve-prospect')
    getProspectByPatientIdMock.mockResolvedValue(null)
    getPatientMock.mockResolvedValue({ id: 'patient-1', phone: '5547988443635' })
    getProspectByPhoneMock.mockResolvedValue(null)

    const result = await resolveProspectForPatient(TENANT, {
      patientId: 'patient-1',
      phone: '5547999998888',
    })

    expect(result).toBeNull()
    // Both phone candidates were tried: the patient's own, then the supplied one.
    expect(getProspectByPhoneMock).toHaveBeenCalledTimes(2)
    expect(getProspectByPhoneMock).toHaveBeenNthCalledWith(1, TENANT, '5547988443635')
    expect(getProspectByPhoneMock).toHaveBeenNthCalledWith(2, TENANT, '5547999998888')
  })

  it('returns null when neither patientId nor phone is given', async () => {
    const { resolveProspectForPatient } = await import('../resolve-prospect')

    const result = await resolveProspectForPatient(TENANT, {})

    expect(result).toBeNull()
    expect(getProspectByPatientIdMock).not.toHaveBeenCalled()
    expect(getPatientMock).not.toHaveBeenCalled()
    expect(getProspectByPhoneMock).not.toHaveBeenCalled()
  })
})
