import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Bem-vindo | FloraClin',
}
import { getAuthContext } from '@/lib/auth'
import { getTenant, listProcedureTypes } from '@/db/queries/tenants'
import { listProducts } from '@/db/queries/products'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { hasPlaceholderName } from '@/lib/clinic-placeholder'
import { isOnboardingCompleted } from '@/lib/onboarding-status'
import { AnalyticsProvider } from '@/components/analytics/analytics-provider'
import { onboardingDraftSchema } from '@/validations/onboarding'
import { addressSchema, workingHoursSchema } from '@/validations/tenant'

export default async function OnboardingPage() {
  const auth = await getAuthContext()

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
  const address = addressSchema.safeParse(tenant.address)
  const workingHours = workingHoursSchema.safeParse(tenant.workingHours)

  return (
    <>
      <AnalyticsProvider userId={auth.userId} tenantId={auth.tenantId} enabled={!auth.isPlatformAdmin} />
      <OnboardingWizard
        // A stand-in name ("Clínica de Ana") from a Google sign-up is not
        // something to confirm: start empty so the real name is asked for.
        tenantName={hasPlaceholderName(settings) ? '' : tenant.name}
        phoneRequired
        tenantPhone={tenant.phone}
        tenantEmail={tenant.email}
        tenantAddress={address.data ?? null}
        tenantWorkingHours={workingHours.data ?? null}
        draft={draft.success ? draft.data : null}
        existingProcedureTypes={procedureTypesForWizard}
        existingProducts={existingProducts}
      />
    </>
  )
}
