import type { Metadata } from 'next'
import { requireRole } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Configurações | FloraClin',
}
import { getTenant, listProcedureTypes, listConsentTemplates } from '@/db/queries/tenants'
import { listTenantUsers } from '@/db/queries/users'
import { SettingsPageClient } from './settings-page-client'

export default async function ConfiguracoesPage() {
  const auth = await requireRole('owner')

  const [tenant, procedureTypes, members, consentTemplates] = await Promise.all([
    getTenant(auth.tenantId),
    listProcedureTypes(auth.tenantId),
    listTenantUsers(auth.tenantId),
    listConsentTemplates(auth.tenantId),
  ])

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
      members={members}
      consentTemplates={consentTemplates}
      currentUserId={auth.userId}
    />
  )
}
