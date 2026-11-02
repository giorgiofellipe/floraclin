import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Bem-vindo | FloraClin',
}
import { getAuthContext } from '@/lib/auth'
import { getTenant, listProcedureTypes } from '@/db/queries/tenants'
import { listProducts } from '@/db/queries/products'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { hasPlaceholderName, suggestedClinicName } from '@/lib/clinic-placeholder'
import { isOnboardingCompleted } from '@/lib/onboarding-status'
import { AnalyticsProvider } from '@/components/analytics/analytics-provider'
import { EmailConfirmationBanner } from '@/components/layout/email-confirmation-banner'
import { SignupConversionTracker } from '@/app/confirm-email/signup-conversion-tracker'
import { onboardingDraftSchema } from '@/validations/onboarding'
import { EmailConfirmedToast } from '@/components/layout/email-confirmed-toast'
import { wantsEmailConfirmedToast, withEmailConfirmedParam } from '@/lib/email-confirmed-toast'

interface OnboardingPageProps {
  searchParams: Promise<{ meta_event_id?: string | string[]; email_confirmed?: string | string[] }>
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const auth = await getAuthContext()
  const { meta_event_id: metaEventId, email_confirmed: emailConfirmed } = await searchParams
  // A hand-made ?email_confirmed=1 never says so next to the "Confirme seu e-mail" banner.
  const showEmailConfirmed = wantsEmailConfirmedToast(emailConfirmed) && auth.emailVerified !== false
  // The confirmation link lands here; when onboarding is done (or not theirs
  // to run) the "E-mail confirmado." toast moves on to the dashboard with it.
  const dashboardPath = showEmailConfirmed ? withEmailConfirmedParam('/dashboard') : '/dashboard'

  // Only owners can run onboarding
  if (auth.role !== 'owner') {
    redirect(dashboardPath)
  }

  const tenant = await getTenant(auth.tenantId)
  if (!tenant) {
    redirect('/login')
  }

  const settings = (tenant.settings as Record<string, unknown>) || {}
  if (isOnboardingCompleted(settings)) {
    redirect(dashboardPath)
  }

  // Load existing procedure types (in case user partially completed onboarding before)
  const existingProcedureTypes = await listProcedureTypes(auth.tenantId)

  const procedureTypesForWizard = existingProcedureTypes.map(pt => ({
    id: pt.id,
    name: pt.name,
    category: pt.category,
    description: pt.description,
    defaultPrice: pt.defaultPrice,
    estimatedDurationMin: pt.estimatedDurationMin,
    preProcedureInstructions: pt.preProcedureInstructions,
    postProcedureCare: pt.postProcedureCare,
    isActive: pt.isActive,
  }))

  // Load existing products (in case user partially completed onboarding before)
  const existingProducts = await listProducts(auth.tenantId)

  const draft = onboardingDraftSchema.safeParse(settings.onboarding_draft)
  const suggestedName = hasPlaceholderName(settings) ? suggestedClinicName(auth.fullName, auth.email) : null

  return (
    <>
      <AnalyticsProvider userId={auth.userId} tenantId={auth.tenantId} enabled={!auth.isPlatformAdmin} />
      {/* Signup now lands here instead of /confirm-email, so the browser
          half of CompleteRegistration (paired with the server's by this id)
          moved here with it. Consent-gated inside trackMetaEvent. */}
      <SignupConversionTracker eventId={typeof metaEventId === 'string' ? metaEventId : null} />
      <EmailConfirmedToast show={showEmailConfirmed} />
      {auth.emailVerified === false && <EmailConfirmationBanner email={auth.email} />}
      <OnboardingWizard
        // A clinic created on arrival after Google sign-up only has a stand-in
        // name ("Clínica de Ana"). Instead of an empty field, suggest one from
        // the Google profile; the flag clears once a name is saved, so what
        // the owner typed is never replaced.
        tenantName={suggestedName ?? tenant.name}
        tenantNameSuggested={Boolean(suggestedName)}
        phoneRequired
        tenantPhone={tenant.phone}
        draft={draft.success ? draft.data : null}
        existingProcedureTypes={procedureTypesForWizard}
        existingProducts={existingProducts}
      />
    </>
  )
}
