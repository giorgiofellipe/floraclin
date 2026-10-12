import { NextResponse } from 'next/server'
import { getValidToken, markTokenUsed } from '@/db/queries/anamnesis-tokens'
import { getAnamnesis, upsertAnamnesis, StaleDataError } from '@/db/queries/anamnesis'
import { getCurrentAnamnesisTemplate } from '@/db/queries/anamnesis-templates'
import { anamnesisPublicSaveBodySchema } from '@/lib/anamnesis/schemas'
import { prepareAnamnesisSave } from '@/lib/anamnesis/prepare-save'
import type { AnamnesisTemplate } from '@/lib/anamnesis/types'
import { createAuditLog } from '@/lib/audit'
import { handleApiError } from '@/lib/api-error'
import { isSubscriptionActive } from '@/lib/plans'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const row = await getValidToken(token)

    if (!row) {
      return NextResponse.json(
        { error: 'Link expirado ou já utilizado' },
        { status: 404 }
      )
    }

    // Gate on the tenant the token resolves to, not any session the caller
    // might hold. The patient may be filling this out while an unrelated
    // clinic's subscription is inactive; that must not block them.
    if (!(await isSubscriptionActive(row.tenantId))) {
      return NextResponse.json(
        { error: 'Esta clínica não está aceitando envios no momento.' },
        { status: 403 }
      )
    }

    return NextResponse.json({
      firstName: row.patientName.split(' ')[0],
      patientId: row.patientId,
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const row = await getValidToken(token)

    if (!row) {
      return NextResponse.json(
        { error: 'Link expirado ou já utilizado' },
        { status: 404 }
      )
    }

    // Gate on the tenant the token resolves to, not any session the caller
    // might hold. The patient may be filling this out while an unrelated
    // clinic's subscription is inactive; that must not block them.
    if (!(await isSubscriptionActive(row.tenantId))) {
      return NextResponse.json(
        { error: 'Esta clínica não está aceitando envios no momento.' },
        { status: 403 }
      )
    }

    const body = anamnesisPublicSaveBodySchema.safeParse(await request.json())
    if (!body.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })

    const current = await getCurrentAnamnesisTemplate(row.tenantId)
    // A staff save landing between the read and the write (an insert conflict or a moved
    // updated_at) fails the first attempt; the retry merges over that save.
    const result = await mergeAndSave(row, current, body.data).catch((error) => {
      if (!(error instanceof StaleDataError)) throw error
      return mergeAndSave(row, current, body.data)
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    await createAuditLog({
      tenantId: row.tenantId,
      userId: row.createdBy,
      action: result.isCreate ? 'create' : 'update',
      entityType: 'anamnesis',
      entityId: result.id,
      changes: { submittedVia: { old: null, new: 'public_link' } },
    })

    await markTokenUsed(token)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof StaleDataError) return NextResponse.json({ error: error.message }, { status: 409 })
    return handleApiError(error, request)
  }
}

async function mergeAndSave(
  row: { tenantId: string; patientId: string; createdBy: string },
  current: AnamnesisTemplate,
  body: { templateVersion: number; responses: Record<string, unknown> },
) {
  const existing = await getAnamnesis(row.tenantId, row.patientId)
  const prepared = prepareAnamnesisSave({ mode: 'public', existing, current, body })
  if (!prepared.ok) return prepared
  const saved = await upsertAnamnesis(
    row.tenantId,
    row.patientId,
    row.createdBy,
    prepared.write,
    existing ? new Date(existing.updatedAt) : undefined,
  )
  return { ok: true as const, id: saved.id, isCreate: !existing }
}
