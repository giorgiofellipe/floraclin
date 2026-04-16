import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Bem-vindo | FloraClin',
}
import { getAuthContext } from '@/lib/auth'
import { getTenant, listProcedureTypes } from '@/db/queries/tenants'
import { listProducts } from '@/db/queries/products'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

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

  // If onboarding is already completed, redirect to dashboard
  const settings = (tenant.settings as Record<string, unknown>) || {}
  if (settings.onboarding_completed === true) {
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
    isActive: pt.isActive,
  }))

  // Load existing products (in case user partially completed onboarding before)
  const existingProducts = await listProducts(auth.tenantId)

  return (
    <OnboardingWizard
      tenantName={tenant.name}
      existingProcedureTypes={procedureTypesForWizard}
      existingProducts={existingProducts}
    />
  )
}
