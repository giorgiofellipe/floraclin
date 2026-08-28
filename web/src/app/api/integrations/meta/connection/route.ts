import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import {
  getMetaConnectionRaw,
  upsertMetaConnection,
  deleteMetaConnection,
  recordAcknowledgement,
} from '@/db/queries/meta-connections'
import { listRecentEvents } from '@/db/queries/meta-events'
import { createAuditLog } from '@/lib/audit'

const RECENT_EVENTS_LIMIT = 20

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

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
    const body = await request.json()
    const { datasetId, accessToken, testEventCode, advancedMatchingEnabled, acknowledgementVersion } = body

    if (!datasetId || !accessToken) {
      return NextResponse.json({ error: 'datasetId e accessToken são obrigatórios.' }, { status: 400 })
    }

    // Enforced here, not only in the settings UI: an LGPD acknowledgement
    // recorded only client side leaves no evidence a controller ever agreed.
    if (!acknowledgementVersion) {
      return NextResponse.json({ error: 'acknowledgementVersion é obrigatório.' }, { status: 400 })
    }

    const connection = await upsertMetaConnection(ctx.tenantId, {
      datasetId,
      accessToken,
      connectionType: 'manual',
      testEventCode: testEventCode ?? null,
      advancedMatchingEnabled: advancedMatchingEnabled ?? true,
    })

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
