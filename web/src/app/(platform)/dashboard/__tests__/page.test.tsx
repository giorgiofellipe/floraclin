import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const { authCtx, toastProps } = vi.hoisted(() => ({
  authCtx: { current: {} as Record<string, unknown> },
  toastProps: { current: null as null | Record<string, unknown> },
}))

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn(async () => authCtx.current) }))
vi.mock('../dashboard-page-client', () => ({ DashboardPageClient: () => null }))
vi.mock('@/components/layout/email-confirmed-toast', () => ({
  EmailConfirmedToast: (props: Record<string, unknown>) => {
    toastProps.current = props
    return null
  },
}))

import DashboardPage from '../page'

async function renderPage(search: Record<string, string>) {
  render(await DashboardPage({ searchParams: Promise.resolve(search) }))
}

beforeEach(() => {
  toastProps.current = null
  authCtx.current = { userId: 'u1', tenantId: 't1', role: 'owner', isPlatformAdmin: false, emailVerified: true }
})

describe('dashboard page', () => {
  it('says "E-mail confirmado." to a confirmed owner the link sent here', async () => {
    await renderPage({ email_confirmed: '1' })
    expect(toastProps.current).toEqual({ show: true })
  })

  // Catches a hand-typed ?email_confirmed=1 telling an unconfirmed owner it is done.
  it('does not say "E-mail confirmado." to an owner who is still unconfirmed', async () => {
    authCtx.current = { ...authCtx.current, emailVerified: false }
    await renderPage({ email_confirmed: '1' })
    expect(toastProps.current).toEqual({ show: false })
  })
})
