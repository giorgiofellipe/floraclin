'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTenant, useProcedureTypes, useProducts, useTenantUsers, useConsentTemplates } from '@/hooks/queries/use-settings'
import { queryKeys } from '@/hooks/queries/query-keys'
import { getTemplatesForProcedureTypesAction } from '@/actions/evaluation-templates'
import { SettingsPageClient } from './settings-page-client'
import ConfiguracoesLoading from './loading'

interface ConfiguracoesPageClientProps {
  currentUserId: string
}

export function ConfiguracoesPageClientWrapper({ currentUserId }: ConfiguracoesPageClientProps) {
  const { data: tenant, isLoading: tenantLoading } = useTenant()
  const { data: procedureTypes, isLoading: ptLoading } = useProcedureTypes()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: members, isLoading: membersLoading } = useTenantUsers()
  const { data: consentTemplates, isLoading: ctLoading } = useConsentTemplates()

  const procedureTypeIds = useMemo(
    () => (procedureTypes ?? []).map((pt: { id: string }) => pt.id),
    [procedureTypes]
  )

  const { data: evaluationTemplates } = useQuery({
    queryKey: queryKeys.settings.evaluationTemplates(procedureTypeIds),
    queryFn: () =>
      procedureTypeIds.length > 0
        ? getTemplatesForProcedureTypesAction(procedureTypeIds)
        : Promise.resolve([]),
    enabled: procedureTypeIds.length > 0,
  })

  const templateStatusMap = useMemo(() => {
    const map: Record<string, boolean> = {}
    if (evaluationTemplates) {
      for (const tmpl of evaluationTemplates) {
        map[tmpl.procedureTypeId] = true
      }
    }
    return map
  }, [evaluationTemplates])

  const isLoading = tenantLoading || ptLoading || productsLoading || membersLoading || ctLoading

  if (isLoading) {
    return <ConfiguracoesLoading />
  }

  if (!tenant) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Erro ao carregar configura\u00e7\u00f5es.</p>
      </div>
    )
  }

  return (
    <SettingsPageClient
      tenant={tenant}
      procedureTypes={procedureTypes ?? []}
      products={products ?? []}
      members={members ?? []}
      consentTemplates={consentTemplates ?? []}
      currentUserId={currentUserId}
      templateStatusMap={templateStatusMap}
    />
  )
}
