import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  listPackageTemplates,
  createPackageTemplate,
} from '@/db/queries/packages'
import { packageTemplateSchema } from '@/validations/package'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const templates = await listPackageTemplates(ctx.tenantId)
    return NextResponse.json(templates)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
