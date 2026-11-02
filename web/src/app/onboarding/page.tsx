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

interface OnboardingPageProps {
  searchParams: Promise<{ meta_event_id?: string | string[] }>
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const auth = await getAuthContext()
  const { meta_event_id: metaEventId } = await searchParams

  // Only owners can run onboarding
  if (auth.role !== 'owner') {
    redirect('/dashboard')
  }

  const tenant = await getTenant(auth.tenantId)
  if (!tenant) {
    redirect('/login')
  }

  const settings = (tenant.settings as Record<string, unknown>) || {}
  if (isOnboardingCompleted(settings)) {
    redirect('/dashboard')
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

  return (
    <>
      <AnalyticsProvider userId={auth.userId} tenantId={auth.tenantId} enabled={!auth.isPlatformAdmin} />
      {/* Signup now lands here instead of /confirm-email, so the browser
          half of CompleteRegistration (paired with the server's by this id)
          moved here with it. Consent-gated inside trackMetaEvent. */}
      <SignupConversionTracker eventId={typeof metaEventId === 'string' ? metaEventId : null} />
      {auth.emailVerified === false && <EmailConfirmationBanner email={auth.email} />}
      <OnboardingWizard
        // A clinic created on arrival after Google sign-up only has a stand-in
        // name ("Clínica de Ana"). Instead of an empty field, suggest one from
        // the Google profile; the flag clears once a name is saved, so what
        // the owner typed is never replaced.
        tenantName={hasPlaceholderName(settings) ? suggestedClinicName(auth.fullName, auth.email) : tenant.name}
        phoneRequired
        tenantPhone={tenant.phone}
        draft={draft.success ? draft.data : null}
        existingProcedureTypes={procedureTypesForWizard}
        existingProducts={existingProducts}
      />
    </>
  )
}
