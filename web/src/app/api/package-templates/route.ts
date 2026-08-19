import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  listPackageTemplates,
  createPackageTemplate,
} from '@/db/queries/packages'
import { packageTemplateSchema } from '@/validations/package'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const templates = await listPackageTemplates(ctx.tenantId)
    return NextResponse.json(templates)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = packageTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const template = await createPackageTemplate(ctx.tenantId, {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      defaultPrice: parsed.data.defaultPrice ?? null,
      validityMonths: parsed.data.validityMonths ?? null,
      lines: parsed.data.lines,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'package_template',
      entityId: template.id,
      changes: { template: { old: null, new: parsed.data } },
    })

    return NextResponse.json({ success: true, data: template })
  } catch (error) {
    return handleApiError(error, request)
  }
}
