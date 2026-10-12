import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { handleApiError } from '@/lib/api-error'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '@/lib/anamnesis/default-template'
import { anamnesisSectionsSchema } from '@/lib/anamnesis/schemas'
import { getCurrentAnamnesisTemplate, saveAnamnesisTemplate } from '@/db/queries/anamnesis-templates'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), sections: anamnesisSectionsSchema }),
  z.object({ action: z.literal('reset') }),
])

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    return NextResponse.json(await getCurrentAnamnesisTemplate(ctx.tenantId))
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos: ' + parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      )
    }

    const sections = parsed.data.action === 'reset' ? DEFAULT_ANAMNESIS_TEMPLATE.sections : parsed.data.sections
    const result = await saveAnamnesisTemplate(ctx.tenantId, sections)
    if (result.changed) {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: result.previous.version === DEFAULT_ANAMNESIS_TEMPLATE.version ? 'create' : 'update',
        entityType: 'anamnesis_template',
        entityId: result.id,
        changes: {
          sections: { old: result.previous.sections, new: result.template.sections },
          version: { old: result.previous.version, new: result.template.version },
        },
      })
    }
    return NextResponse.json({ success: true, data: result.template })
  } catch (error) {
    return handleApiError(error, request)
  }
}
