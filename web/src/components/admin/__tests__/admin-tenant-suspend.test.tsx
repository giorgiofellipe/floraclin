import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { AdminTenantList } from '../admin-tenant-list'

/**
 * Suspension used to be one click on an X icon.
 *
 * That was defensible while the button rejected a clinic still waiting to be
 * let in. It now soft-deletes a live one, and since `getAuthContext` joins the
 * tenant and excludes deleted ones, every user of that clinic loses access on
 * their very next request, mid-session. A misclick on a dense admin list is
 * an outage for a paying customer, so it goes behind a confirmation.
 */

const mutateAsync = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/hooks/queries/use-admin-tenants', () => ({
  useAdminTenants: () => ({
    data: {
      data: [
        {
          id: 'tenant-1',
          name: 'Clínica Viva',
          slug: 'clinica-viva',
          status: 'active',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
    },
    isLoading: false,
  }),
  useAdminTenantDetail: () => ({ data: null, isLoading: false }),
}))

vi.mock('@/hooks/mutations/use-admin-tenant-mutations', () => ({
  useSuspendTenant: () => ({ mutateAsync, isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue(undefined)
})

describe('suspending a clinic', () => {
  it('does not suspend on the first click', async () => {
    render(<AdminTenantList />)

    const button = await screen.findByTestId('admin-tenant-suspend')
    button.click()

    await waitFor(() => expect(screen.getByText('Suspender clínica')).toBeInTheDocument())
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('suspends once confirmed', async () => {
    render(<AdminTenantList />)

    ;(await screen.findByTestId('admin-tenant-suspend')).click()
    const confirm = await screen.findByTestId('admin-tenant-suspend-confirm')
    confirm.click()

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('tenant-1'))
  })

  it('warns that access is cut immediately', async () => {
    // The admin needs to know this is not a soft flag: open sessions stop
    // working on their next request.
    render(<AdminTenantList />)

    ;(await screen.findByTestId('admin-tenant-suspend')).click()

    await waitFor(() =>
      expect(screen.getByText(/perdem o acesso imediatamente/i)).toBeInTheDocument(),
    )
  })
})
