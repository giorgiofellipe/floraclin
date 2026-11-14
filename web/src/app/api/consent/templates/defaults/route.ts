import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { seedDefaultConsentTemplates } from '@/db/queries/consent'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const created = await seedDefaultConsentTemplates(ctx.tenantId)

    for (const template of created) {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'create',
        entityType: 'consent_template',
        entityId: template.id,
        changes: { template: { old: null, new: { type: template.type, title: template.title } } },
      })
    }

    return NextResponse.json({ success: true, data: { created: created.length } })
  } catch (error) {
    return handleApiError(error, request)
  }
}
