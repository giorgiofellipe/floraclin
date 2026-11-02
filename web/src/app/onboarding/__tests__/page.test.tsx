/**
 * The onboarding page decides what step 1 starts with: after a Google
 * sign-up the clinic only has a stand-in name, and the field is prefilled from
 * the Google profile instead of left empty; a name the owner saved is never
 * replaced. It also carries the browser half of CompleteRegistration that used
 * to live on /confirm-email; the confirmation banner waits for the dashboard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { authCtx, tenant, wizardProps, trackerProps, toastProps } = vi.hoisted(() => ({
  toastProps: { current: null as null | Record<string, unknown> },
  authCtx: { current: {} as Record<string, unknown> },
  tenant: { current: {} as Record<string, unknown> },
  wizardProps: { current: null as null | Record<string, unknown> },
  trackerProps: { current: null as null | Record<string, unknown> },
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn(async () => authCtx.current) }))
vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(async () => tenant.current),
  listProcedureTypes: vi.fn(async () => []),
}))
vi.mock('@/db/queries/products', () => ({ listProducts: vi.fn(async () => []) }))
vi.mock('@/components/analytics/analytics-provider', () => ({ AnalyticsProvider: () => null }))
vi.mock('@/components/onboarding/onboarding-wizard', () => ({
  OnboardingWizard: (props: Record<string, unknown>) => {
    wizardProps.current = props
    return null
  },
}))
vi.mock('@/app/confirm-email/signup-conversion-tracker', () => ({
  SignupConversionTracker: (props: Record<string, unknown>) => {
    trackerProps.current = props
    return null
  },
}))
vi.mock('@/components/layout/email-confirmed-toast', () => ({
  EmailConfirmedToast: (props: Record<string, unknown>) => {
    toastProps.current = props
    return null
  },
}))
vi.mock('@/components/layout/email-confirmation-banner', () => ({
  EmailConfirmationBanner: ({ email }: { email: string }) => <div data-testid="banner">{email}</div>,
}))

import OnboardingPage from '../page'

async function renderPage(search: Record<string, string> = {}) {
  render(await OnboardingPage({ searchParams: Promise.resolve(search) }))
}

beforeEach(() => {
  wizardProps.current = null
  trackerProps.current = null
  toastProps.current = null
  authCtx.current = {
    userId: 'u1',
    tenantId: 't1',
    role: 'owner',
    email: 'ana@gmail.com',
    fullName: 'Ana Souza',
    isPlatformAdmin: false,
    emailVerified: true,
  }
  tenant.current = { id: 't1', name: 'Clínica de Ana', phone: null, settings: { clinic_name_placeholder: true } }
})

describe('onboarding page', () => {
  it('prefills the clinic name from the Google profile while the stand-in is there', async () => {
    await renderPage()
    expect(wizardProps.current?.tenantName).toBe('Clínica Ana Souza')
    expect(wizardProps.current?.tenantNameSuggested).toBe(true)
  })

  it('flags no suggestion when the Google profile has no usable name', async () => {
    authCtx.current = { ...authCtx.current, fullName: 'ana', email: 'ana@gmail.com' }
    await renderPage()
    expect(wizardProps.current?.tenantName).toBe('')
    expect(wizardProps.current?.tenantNameSuggested).toBe(false)
  })

  it('keeps the name the owner saved', async () => {
    tenant.current = { ...tenant.current, name: 'Studio Bella', settings: { clinic_name_placeholder: false } }
    await renderPage()
    expect(wizardProps.current?.tenantName).toBe('Studio Bella')
    expect(wizardProps.current?.tenantNameSuggested).toBe(false)
  })

  it('no longer hands the wizard the e-mail, address or hours', async () => {
    await renderPage()
    expect(wizardProps.current).not.toHaveProperty('tenantEmail')
    expect(wizardProps.current).not.toHaveProperty('tenantAddress')
    expect(wizardProps.current).not.toHaveProperty('tenantWorkingHours')
  })

  it('never shows the confirmation banner, not even to an unconfirmed owner', async () => {
    authCtx.current = { ...authCtx.current, email: 'novo@clinica.test', emailVerified: false }
    await renderPage()
    expect(screen.queryByTestId('banner')).toBeNull()
    expect(screen.queryByText('novo@clinica.test')).toBeNull()
  })

  it('passes the Meta event id from signup to the pixel tracker', async () => {
    await renderPage({ meta_event_id: 'complete_registration:abc' })
    expect(trackerProps.current).toEqual({ eventId: 'complete_registration:abc' })
  })

  it('sends a finished clinic to the dashboard', async () => {
    tenant.current = { ...tenant.current, settings: { onboarding_completed: true } }
    await expect(renderPage()).rejects.toThrow(/^redirect:\/dashboard$/)
  })

  it('asks for the confirmed toast only when the confirmation link lands here with the parameter', async () => {
    await renderPage({ email_confirmed: '1' })
    expect(toastProps.current).toEqual({ show: true })

    await renderPage()
    expect(toastProps.current).toEqual({ show: false })
  })

  it('carries the confirmed toast on to the dashboard when the clinic is already set up', async () => {
    tenant.current = { ...tenant.current, settings: { onboarding_completed: true } }
    await expect(renderPage({ email_confirmed: '1' })).rejects.toThrow(/^redirect:\/dashboard\?email_confirmed=1$/)
  })

  it('does not say "E-mail confirmado." to an owner who is still unconfirmed', async () => {
    authCtx.current = { ...authCtx.current, emailVerified: false }
    await renderPage({ email_confirmed: '1' })
    expect(toastProps.current).toEqual({ show: false })
  })

  it('ignores any other value of the parameter', async () => {
    tenant.current = { ...tenant.current, settings: { onboarding_completed: true } }
    await expect(renderPage({ email_confirmed: 'yes' })).rejects.toThrow(/^redirect:\/dashboard$/)
  })
})
