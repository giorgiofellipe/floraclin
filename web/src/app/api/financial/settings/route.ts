import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import {
  getFinancialSettings,
  updateFinancialSettings,
  getExpenseCategories,
} from '@/db/queries/financial-settings'
import { updateFinancialSettingsSchema } from '@/validations/financial-settings'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    const [settings, categories] = await Promise.all([
      getFinancialSettings(ctx.tenantId),
      getExpenseCategories(ctx.tenantId),
    ])

    return NextResponse.json({ settings, categories })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

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
    return handleApiError(error, request)
  }
}
