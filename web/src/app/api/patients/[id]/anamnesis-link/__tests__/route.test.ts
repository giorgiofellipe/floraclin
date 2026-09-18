/**
 * The route mints a link token from the `[id]` path param. The writer guard in
 * `createAnamnesisToken` is what makes a cross-tenant token impossible; this
 * preflight is what makes the answer a 404 instead of a 500 plus a Sentry
 * event, matching the sibling send route.
 *
 * The guard is `requireWrite`, so the route also refuses a lapsed
 * subscription. `write-access.test.ts` covers what that guard decides; here it
 * is mocked, and what matters is that the route returns its response
 * untouched and mints nothing when it blocks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(),
}))

vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis-tokens', () => ({
  createAnamnesisToken: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { getPatient } from '@/db/queries/patients'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'
import { POST } from '../route'

const AUTH_OK = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: 'receptionist' as const,
  email: 'reception@example.com',
  fullName: 'Reception Example',
  isPlatformAdmin: false,
}

const EXPIRES_AT = new Date('2026-08-28T15:00:00.000Z')

function postRequest(patientId: string): Request {
  return new Request(`http://localhost/api/patients/${patientId}/anamnesis-link`, {
    method: 'POST',
  })
}

function paramsOf<T extends object>(value: T): Promise<T> {
  return Promise.resolve(value)
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(requireWrite).mockReset()
  vi.mocked(getPatient).mockReset()
  vi.mocked(createAnamnesisToken).mockReset()

  vi.mocked(requireWrite).mockResolvedValue({ ctx: AUTH_OK, blocked: null } as never)
  vi.mocked(getPatient).mockResolvedValue({ id: 'patient-1' } as never)
  vi.mocked(createAnamnesisToken).mockResolvedValue({
    token: 'token-uuid',
    expiresAt: EXPIRES_AT,
  } as never)
})

describe('POST /api/patients/[id]/anamnesis-link', () => {
  it('returns 404 and mints nothing when the patient is in another tenant', async () => {
    vi.mocked(getPatient).mockResolvedValueOnce(null)

    const res = await POST(postRequest('victim-patient'), {
      params: paramsOf({ id: 'victim-patient' }),
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Paciente não encontrado' })
    expect(createAnamnesisToken).not.toHaveBeenCalled()
  })

  it('scopes the patient lookup to the caller tenant', async () => {
    await POST(postRequest('patient-1'), { params: paramsOf({ id: 'patient-1' }) })

    expect(getPatient).toHaveBeenCalledWith('tenant-1', 'patient-1')
  })

  it('returns the link for a patient in the caller tenant', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example')

    const res = await POST(postRequest('patient-1'), { params: paramsOf({ id: 'patient-1' }) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.url).toBe('https://app.example/a/token-uuid')
    expect(json.expiresAt).toBe(EXPIRES_AT.toISOString())
    expect(createAnamnesisToken).toHaveBeenCalledWith('tenant-1', 'patient-1', 'user-1')
  })

  it('asks the guard for the roles that may issue links', async () => {
    await POST(postRequest('patient-1'), { params: paramsOf({ id: 'patient-1' }) })

    expect(requireWrite).toHaveBeenCalledWith('owner', 'practitioner', 'receptionist')
  })

  it('returns the guard response and mints nothing when it blocks', async () => {
    // A wrong role and a lapsed subscription both arrive here the same way.
    vi.mocked(requireWrite).mockResolvedValueOnce({
      ctx: null,
      blocked: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    } as never)

    const res = await POST(postRequest('patient-1'), { params: paramsOf({ id: 'patient-1' }) })

    expect(res.status).toBe(403)
    expect(getPatient).not.toHaveBeenCalled()
    expect(createAnamnesisToken).not.toHaveBeenCalled()
  })
})
