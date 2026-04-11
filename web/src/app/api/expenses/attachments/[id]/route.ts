import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { deleteExpenseAttachment } from '@/db/queries/expenses'
import { deleteFile } from '@/lib/storage'

export async function DELETE(
  _request: Request,
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
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg.includes('não encontrado')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
