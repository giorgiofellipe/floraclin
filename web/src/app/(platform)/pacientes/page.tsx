import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { canRoleUseWhatsApp } from '@/lib/whatsapp-mode'
import { PacientesPageClient } from './pacientes-page-client'

export const metadata: Metadata = {
  title: 'Pacientes | FloraClin',
}

export default async function PacientesPage() {
  const ctx = await getAuthContext()
  const tenant = await getTenant(ctx.tenantId)
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>

  return (
    <Suspense fallback={<div className="text-muted-foreground">Carregando...</div>}>
      <PacientesPageClient whatsappInApp={canRoleUseWhatsApp(settings, ctx.role)} />
    </Suspense>
  )
}
