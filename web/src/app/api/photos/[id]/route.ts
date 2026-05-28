import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { deletePhotoAsset, getPhotoAsset } from '@/db/queries/photos'
import { db } from '@/db/client'
import { photoAssets } from '@/db/schema'
import { cropBoxSchema } from '@/validations/photo'

const patchBody = z.object({
  cropBox: cropBoxSchema.nullable(),
  cropAspect: z.number().positive().nullable(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireRole('owner', 'practitioner')
    const { id } = await params

    const body = await request.json().catch(() => null)
    const parsed = patchBody.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Dados inválidos' }, { status: 400 })
    }

    const { cropBox, cropAspect } = parsed.data
    // Both fields must be present together — either you set a crop (and tell us the
    // resulting aspect) or you clear both. Mixed states are rejected.
    if ((cropBox === null) !== (cropAspect === null)) {
      return NextResponse.json(
        { success: false, error: 'cropBox e cropAspect devem ser enviados juntos' },
        { status: 400 },
      )
    }

    // Verify the photo belongs to this tenant before update.
    const photo = await getPhotoAsset(context.tenantId, id)
    if (!photo) {
      return NextResponse.json({ success: false, error: 'Foto não encontrada' }, { status: 404 })
    }

    const [updated] = await db
      .update(photoAssets)
      .set({
        cropBox: cropBox,
        cropAspect: cropAspect === null ? null : cropAspect.toString(),
      })
      .where(
        and(
          eq(photoAssets.tenantId, context.tenantId),
          eq(photoAssets.id, id),
        ),
      )
      .returning()

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Foto não encontrada' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'update',
      entityType: 'photo_asset',
      entityId: id,
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Photo crop update error:', error)
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireRole('owner', 'practitioner')
    const { id } = await params

    const deleted = await deletePhotoAsset(context.tenantId, id)
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Foto nao encontrada' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'delete',
      entityType: 'photo_asset',
      entityId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Photo delete error:', error)
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 })
  }
}
