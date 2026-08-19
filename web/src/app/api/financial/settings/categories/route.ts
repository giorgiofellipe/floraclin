import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import {
  getExpenseCategories,
  createExpenseCategory,
} from '@/db/queries/financial-settings'
import { expenseCategorySchema } from '@/validations/expenses'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    const categories = await getExpenseCategories(ctx.tenantId)

    return NextResponse.json({ data: categories })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner')

    const body = await request.json()
    const parsed = expenseCategorySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const category = await createExpenseCategory(ctx.tenantId, ctx.userId, parsed.data)

    return NextResponse.json({ success: true, data: category })
  } catch (error) {
    return handleApiError(error, request)
  }
}
