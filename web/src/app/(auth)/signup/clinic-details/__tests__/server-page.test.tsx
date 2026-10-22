import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn(), memberships: vi.fn() }))
vi.mock('@/lib/auth-config', () => ({ auth: () => h.auth() }))
vi.mock('@/db/queries/clinic-membership', () => ({ getClinicMemberships: (...a: unknown[]) => h.memberships(...a) }))
vi.mock('../clinic-details-form', () => ({ ClinicDetailsForm: () => null }))

import ClinicDetailsPage from '../page'

async function props() {
  const el = (await ClinicDetailsPage()) as { props: { hasClinic: boolean; suspended: boolean } }
  return el.props
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'user-1' } })
})

describe('clinic details page: who is asked for clinic details', () => {
  it('asks a user with no clinic', async () => {
    h.memberships.mockResolvedValue({ liveTenantIds: [], suspended: false })
    expect(await props()).toEqual({ hasClinic: false, suspended: false })
    expect(h.memberships).toHaveBeenCalledWith('user-1')
  })

  it('tells a user whose only clinic is suspended, instead of asking', async () => {
    h.memberships.mockResolvedValue({ liveTenantIds: [], suspended: true })
    expect(await props()).toEqual({ hasClinic: false, suspended: true })
  })

  it('sends a user with a live clinic in, even if another of theirs is suspended', async () => {
    h.memberships.mockResolvedValue({ liveTenantIds: ['tenant-1'], suspended: true })
    expect(await props()).toEqual({ hasClinic: true, suspended: false })
  })

  it('does not look anything up without a session', async () => {
    h.auth.mockResolvedValue(null)
    expect(await props()).toEqual({ hasClinic: false, suspended: false })
    expect(h.memberships).not.toHaveBeenCalled()
  })
})
