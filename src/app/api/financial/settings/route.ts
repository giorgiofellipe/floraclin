import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  getFinancialSettings,
  updateFinancialSettings,
  getExpenseCategories,
} from '@/db/queries/financial-settings'
import { updateFinancialSettingsSchema } from '@/validations/financial-settings'

export async function GET() {
  try {
    const ctx = await requireRole('owner', 'financial')

    const [settings, categories] = await Promise.all([
      getFinancialSettings(ctx.tenantId),
      getExpenseCategories(ctx.tenantId),
    ])

    return NextResponse.json({ settings, categories })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('owner')

    const body = await request.json()
    const parsed = updateFinancialSettingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const settings = await updateFinancialSettings(ctx.tenantId, ctx.userId, parsed.data)

    return NextResponse.json({ success: true, data: settings })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
