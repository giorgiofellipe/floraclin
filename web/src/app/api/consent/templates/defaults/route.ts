import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { seedDefaultConsentTemplates } from '@/db/queries/consent'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const created = await seedDefaultConsentTemplates(ctx.tenantId, ctx.userId)

    return NextResponse.json({ success: true, data: { created: created.length } })
  } catch (error) {
    return handleApiError(error, request)
  }
}
