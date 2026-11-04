import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { AdminTenantList } from '../admin-tenant-list'

const detail = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))

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
    isPending: false,
  }),
  useAdminTenantDetail: () => ({ data: { users: [], settings: detail.settings }, isPending: false }),
}))

vi.mock('@/hooks/mutations/use-admin-tenant-mutations', () => ({
  useSuspendTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('clinic detail import request', () => {
  it('shows when the owner asked for import help, in São Paulo time', async () => {
    detail.settings = { import_help_requested_at: '2026-11-03T15:30:00.000Z' }
    render(<AdminTenantList />)

    ;(await screen.findByTestId('admin-tenant-expand')).click()

    expect(await screen.findByText('Pediu importação em 03/11/2026 12:30')).toBeInTheDocument()
  })

  it('says nothing about import when the owner never asked', async () => {
    detail.settings = {}
    render(<AdminTenantList />)

    ;(await screen.findByTestId('admin-tenant-expand')).click()

    expect(await screen.findByText('Nenhum usuário cadastrado')).toBeInTheDocument()
    expect(screen.queryByText(/Pediu importação/)).toBeNull()
  })
})
