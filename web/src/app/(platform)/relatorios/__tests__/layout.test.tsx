import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

import { requireRole } from '@/lib/auth'
import RelatoriosLayout from '../layout'
import { ForbiddenError } from '@/lib/errors'

const CHILDREN_TEXT = 'conteúdo do relatório'

function renderLayout() {
  return RelatoriosLayout({ children: <div>{CHILDREN_TEXT}</div> })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RelatoriosLayout', () => {
  // `requireRole` is mocked, so which role was refused is decided there, not
  // here — one rejection case covers every refused role (practitioner,
  // receptionist, ...) rather than the same assertion repeated per role name.
  it('renders the forbidden state and never the section content when requireRole rejects', async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new ForbiddenError('Forbidden: insufficient permissions')
    )

    render(await renderLayout())

    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(screen.queryByText(CHILDREN_TEXT)).not.toBeInTheDocument()
  })

  it('lets an owner through to the section content', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'owner',
      email: 'owner@example.com',
      fullName: 'Owner Example',
      isPlatformAdmin: false,
    } as never)

    render(await renderLayout())

    expect(screen.getByText(CHILDREN_TEXT)).toBeInTheDocument()
    expect(screen.queryByText('Acesso restrito')).not.toBeInTheDocument()
  })

  it('lets a financial role through to the section content', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-2',
      role: 'financial',
      email: 'financial@example.com',
      fullName: 'Financial Example',
      isPlatformAdmin: false,
    } as never)

    render(await renderLayout())

    expect(screen.getByText(CHILDREN_TEXT)).toBeInTheDocument()
    expect(screen.queryByText('Acesso restrito')).not.toBeInTheDocument()
  })

  it('always checks the owner and financial roles, regardless of outcome', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'owner',
      email: 'owner@example.com',
      fullName: 'Owner Example',
      isPlatformAdmin: false,
    } as never)

    await renderLayout()

    expect(requireRole).toHaveBeenCalledWith('owner', 'financial')
  })
})
