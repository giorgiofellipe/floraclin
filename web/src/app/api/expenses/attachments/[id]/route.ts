import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { deleteExpenseAttachment } from '@/db/queries/expenses'
import { deleteFile } from '@/lib/storage'
import { handleApiError } from '@/lib/api-error'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'financial')
    if (blocked) return blocked

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
