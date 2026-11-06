import { NextResponse } from 'next/server'
import { findMunicipalityCode } from '@bullcode/fiscal'
import { requireRole } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { handleApiError } from '@/lib/api-error'
import { createAuditLog } from '@/lib/audit'
import { getNfseSettings, saveFiscalSettings } from '@/db/queries/nfse'
import { getTenant } from '@/db/queries/tenants'
import { nfseFiscalSettingsSchema } from '@/validations/nfse'
import { isCompleteAddress } from '@/lib/nfse/taker-address'

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner')

    const [data, tenant] = await Promise.all([getNfseSettings(ctx.tenantId), getTenant(ctx.tenantId)])
    const address = (tenant?.address ?? {}) as { city?: string; state?: string }
    const suggestedMunicipalityCode =
      address.city && address.state ? findMunicipalityCode(address.city, address.state) : null

    return NextResponse.json({
      data,
      suggestedMunicipalityCode,
      clinicAddressComplete: isCompleteAddress(tenant?.address),
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const parsed = nfseFiscalSettingsSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const existing = await getNfseSettings(ctx.tenantId)
    if (!existing) {
      return NextResponse.json(
        { error: 'Envie o certificado digital antes de configurar a NFS-e.', code: 'CERTIFICATE_REQUIRED' },
        { status: 409 },
      )
    }

    await saveFiscalSettings(ctx.tenantId, ctx.userId, parsed.data)

    const changes: Record<string, { old: unknown; new: unknown }> = {}
    for (const [key, value] of Object.entries(parsed.data)) {
      const old = existing[key as keyof typeof existing]
      if (JSON.stringify(old) !== JSON.stringify(value)) changes[key] = { old, new: value }
    }
    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'nfse_settings',
      changes,
    })

    return NextResponse.json({ data: await getNfseSettings(ctx.tenantId) })
  } catch (error) {
    return handleApiError(error, request)
  }
}
