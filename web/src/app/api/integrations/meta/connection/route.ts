import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import {
  getMetaConnectionRaw,
  upsertMetaConnection,
  updateMetaConnectionSettings,
  deleteMetaConnection,
  recordAcknowledgement,
} from '@/db/queries/meta-connections'
import { listRecentEvents } from '@/db/queries/meta-events'
import { createAuditLog } from '@/lib/audit'
import { ACKNOWLEDGEMENT_VERSION } from '@/lib/meta/acknowledgement'

const RECENT_EVENTS_LIMIT = 20

// Lengths mirror `meta_connections`, so an over-long value is a 400 here
// instead of a driver error at insert time. `acknowledgementVersion` is a
// literal, not a string: the audit_logs row has to prove which text the owner
// accepted, and a client-supplied version proves nothing.
//
// `accessToken` absent means a settings-only update on the existing row. An
// OAuth clinic has no token to paste, and must still be able to change
// advanced matching without disconnecting.
const updateConnectionSchema = z.object({
  datasetId: z.string().min(1).max(64),
  accessToken: z.string().min(1).optional(),
  testEventCode: z.string().max(32).nullish(),
  advancedMatchingEnabled: z.boolean().optional(),
  acknowledgementVersion: z.literal(ACKNOWLEDGEMENT_VERSION),
})

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner')

    // Raw, not the status-filtered getter: a disabled or invalid_token
    // connection must still render so the diagnostics panel can show it.
    const connection = await getMetaConnectionRaw(ctx.tenantId)
    const events = await listRecentEvents(ctx.tenantId, RECENT_EVENTS_LIMIT)

    if (!connection) {
      return NextResponse.json({ data: null, events })
    }

    const { accessToken: _accessToken, ...safe } = connection
    return NextResponse.json({ data: safe, events })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const body = await request.json().catch(() => ({}))
    const parsed = updateConnectionSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { datasetId, accessToken, testEventCode, advancedMatchingEnabled, acknowledgementVersion } =
      parsed.data

    // Pasting a token IS the manual path, so a credential update owns the
    // connection type. A settings-only update must never touch it.
    const connection = accessToken
      ? await upsertMetaConnection(ctx.tenantId, {
          datasetId,
          accessToken,
          connectionType: 'manual',
          testEventCode: testEventCode ?? null,
          advancedMatchingEnabled: advancedMatchingEnabled ?? true,
        })
      : await updateMetaConnectionSettings(ctx.tenantId, {
          testEventCode,
          advancedMatchingEnabled,
        })

    if (!connection) {
      return NextResponse.json({ error: 'Conexão com a Meta não encontrada' }, { status: 404 })
    }

    await recordAcknowledgement(ctx.tenantId, ctx.userId, acknowledgementVersion)
    // The connection row only ever holds the current acknowledgement version;
    // a later re-paste would overwrite it. The audit_logs row is what proves
    // which version was accepted at this point in time.
    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'consent_accepted',
      entityType: 'meta_connection',
      entityId: connection.id,
      changes: { acknowledgementVersion: { old: null, new: acknowledgementVersion } },
    })

    const { accessToken: _accessToken, ...safe } = connection
    return NextResponse.json({ data: safe })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('owner')
    await deleteMetaConnection(ctx.tenantId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
