import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn(), memberships: vi.fn() }))
vi.mock('@/lib/auth-config', () => ({ auth: () => h.auth() }))
vi.mock('@/db/queries/clinic-membership', () => ({ getClinicMemberships: (...a: unknown[]) => h.memberships(...a) }))
vi.mock('../clinic-details-form', () => ({ ClinicDetailsForm: () => null }))

import ClinicDetailsPage from '../page'

async function props() {
  const el = (await ClinicDetailsPage()) as { props: { hasClinic: boolean; suspended: boolean; autoStart: boolean } }
  return el.props
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'user-1' } })
})

describe('clinic details page: who is asked for clinic details', () => {
  it('starts a clinic on arrival for a brand-new account, without asking anything', async () => {
    h.memberships.mockResolvedValue({ liveTenantIds: [], suspendedOnly: false, neverMember: true })
    expect(await props()).toEqual({ hasClinic: false, suspended: false, autoStart: true })
    expect(h.memberships).toHaveBeenCalledWith('user-1')
  })

  it('still asks someone who was removed from a clinic (only inactive memberships)', async () => {
    h.memberships.mockResolvedValue({ liveTenantIds: [], suspendedOnly: false, neverMember: false })
    expect(await props()).toEqual({ hasClinic: false, suspended: false, autoStart: false })
  })

  it('tells a user whose only clinic is suspended, instead of asking', async () => {
    h.memberships.mockResolvedValue({ liveTenantIds: [], suspendedOnly: true, neverMember: false })
    expect(await props()).toEqual({ hasClinic: false, suspended: true, autoStart: false })
  })

  it('asks a platform admin with no clinic instead of creating one', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1' }, isPlatformAdmin: true })
    h.memberships.mockResolvedValue({ liveTenantIds: [], suspendedOnly: false, neverMember: true })
    expect(await props()).toEqual({ hasClinic: false, suspended: false, autoStart: false })
  })

  it('sends a user with a live clinic in', async () => {
    h.memberships.mockResolvedValue({ liveTenantIds: ['tenant-1'], suspendedOnly: false, neverMember: false })
    expect(await props()).toEqual({ hasClinic: true, suspended: false, autoStart: false })
  })

  it('does not look anything up without a session', async () => {
    h.auth.mockResolvedValue(null)
    expect(await props()).toEqual({ hasClinic: false, suspended: false, autoStart: false })
    expect(h.memberships).not.toHaveBeenCalled()
  })
})
