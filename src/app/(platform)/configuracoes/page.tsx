import type { Metadata } from 'next'
import { requireRole } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Configurações | FloraClin',
}
import { getTenant, listProcedureTypes, listConsentTemplates } from '@/db/queries/tenants'
import { listProducts } from '@/db/queries/products'
import { listTenantUsers } from '@/db/queries/users'
import { getTemplatesForProcedureTypes } from '@/db/queries/evaluation-templates'
import { SettingsPageClient } from './settings-page-client'

export default async function ConfiguracoesPage() {
  const auth = await requireRole('owner')

  const [tenant, procedureTypes, products, members, consentTemplates] = await Promise.all([
    getTenant(auth.tenantId),
    listProcedureTypes(auth.tenantId),
    listProducts(auth.tenantId),
    listTenantUsers(auth.tenantId),
    listConsentTemplates(auth.tenantId),
  ])

  // Load template statuses for procedure types
  const procedureTypeIds = procedureTypes.map((pt) => pt.id)
  const evaluationTemplates = procedureTypeIds.length > 0
    ? await getTemplatesForProcedureTypes(auth.tenantId, procedureTypeIds)
    : []
  const templateStatusMap: Record<string, boolean> = {}
  for (const tmpl of evaluationTemplates) {
    templateStatusMap[tmpl.procedureTypeId] = true
  }

  if (!tenant) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Erro ao carregar configurações.</p>
      </div>
    )
  }

  return (
    <SettingsPageClient
      tenant={tenant}
      procedureTypes={procedureTypes}
      products={products}
      members={members}
      consentTemplates={consentTemplates}
      currentUserId={auth.userId}
      templateStatusMap={templateStatusMap}
    />
  )
}
