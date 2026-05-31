'use client'

import type { Role } from '@/types'
import { useMemo } from 'react'
import { useTenant, useTenantUsers } from '@/hooks/queries/use-tenant'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'
import { useAllProducts } from '@/hooks/queries/use-products'
import { useConsentTemplates } from '@/hooks/queries/use-consent'
import { useEvaluationTemplates } from '@/hooks/queries/use-evaluation'
import { SettingsPageClient } from './settings-page-client'
import ConfiguracoesLoading from './loading'

interface ConfiguracoesPageClientProps {
  currentUserId: string
  userRole: Role
  initialTab?: string
}

function OwnerSettingsWrapper({ currentUserId, userRole, initialTab, tenant }: ConfiguracoesPageClientProps & { tenant: NonNullable<ReturnType<typeof useTenant>['data']> }) {
  const { data: procedureTypes, isLoading: ptLoading } = useProcedureTypes()
  const { data: products, isLoading: productsLoading } = useAllProducts()
  const { data: members, isLoading: membersLoading } = useTenantUsers()
  const { data: consentTemplates, isLoading: ctLoading } = useConsentTemplates()

  const procedureTypeIds = useMemo(
    () => (procedureTypes ?? []).map((pt: { id: string }) => pt.id),
    [procedureTypes]
  )

  const { data: evaluationTemplates } = useEvaluationTemplates(procedureTypeIds)

  const templateStatusMap = useMemo(() => {
    const map: Record<string, boolean> = {}
    if (evaluationTemplates) {
      for (const tmpl of evaluationTemplates) {
        map[tmpl.procedureTypeId] = true
      }
    }
    return map
  }, [evaluationTemplates])

  if (ptLoading || productsLoading || membersLoading || ctLoading) {
    return <ConfiguracoesLoading />
  }

  return (
    <SettingsPageClient
      tenant={tenant}
      procedureTypes={procedureTypes ?? []}
      products={products ?? []}
      members={members ?? []}
      consentTemplates={consentTemplates ?? []}
      currentUserId={currentUserId}
      userRole={userRole}
      initialTab={initialTab}
      templateStatusMap={templateStatusMap}
    />
  )
}

export function ConfiguracoesPageClientWrapper({ currentUserId, userRole, initialTab }: ConfiguracoesPageClientProps) {
  const { data: tenant, isLoading: tenantLoading } = useTenant()

  if (tenantLoading) {
    return <ConfiguracoesLoading />
  }

  if (!tenant) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Erro ao carregar configurações.</p>
      </div>
    )
  }

  if (userRole === 'owner') {
    return (
      <OwnerSettingsWrapper
        currentUserId={currentUserId}
        userRole={userRole}
        initialTab={initialTab}
        tenant={tenant}
      />
    )
  }

  return (
    <SettingsPageClient
      tenant={tenant}
      procedureTypes={[]}
      products={[]}
      members={[]}
      consentTemplates={[]}
      currentUserId={currentUserId}
      userRole={userRole}
      initialTab={initialTab}
    />
  )
}
