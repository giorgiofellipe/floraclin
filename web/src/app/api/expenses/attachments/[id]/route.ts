import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { deleteExpenseAttachment } from '@/db/queries/expenses'
import { deleteFile } from '@/lib/storage'
import { handleApiError } from '@/lib/api-error'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const result = await deleteExpenseAttachment(ctx.tenantId, id, ctx.userId)

    // Also remove file from Supabase Storage
    if (result.fileUrl) {
      await deleteFile(result.fileUrl)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('não encontrado')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    return handleApiError(error, request)
  }
}
