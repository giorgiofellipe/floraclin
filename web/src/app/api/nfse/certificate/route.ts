import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'
import { createAuditLog } from '@/lib/audit'
import { readCertificate } from '@/lib/nfse/certificate'
import { deleteNfseSettings, getNfseSettings, saveCertificate } from '@/db/queries/nfse'
import { nfseCertificateUploadSchema } from '@/validations/nfse'

const CONFLICT_CODES = new Set(['CERTIFICATE_CNPJ_CHANGED', 'CERTIFICATE_REQUIRED'])

function businessResponse(error: BusinessError) {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: CONFLICT_CODES.has(error.code) ? 409 : 400 },
  )
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner')

    const settings = await getNfseSettings(ctx.tenantId)
    return NextResponse.json({ data: settings?.certificate ?? null })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const parsed = nfseCertificateUploadSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const info = readCertificate(parsed.data.pfxBase64, parsed.data.password)
    const existing = await getNfseSettings(ctx.tenantId)
    if (existing && existing.certificate.cnpj !== info.cnpj) {
      throw new BusinessError(
        'CERTIFICATE_CNPJ_CHANGED',
        'Remova o certificado atual para usar outro CNPJ.',
      )
    }

    await saveCertificate(ctx.tenantId, ctx.userId, { ...info, ...parsed.data })
    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: existing ? 'update' : 'create',
      entityType: 'nfse_settings',
      changes: { certificate: { old: existing?.certificate ?? null, new: info } },
    })

    return NextResponse.json({ data: info })
  } catch (error) {
    if (error instanceof BusinessError) return businessResponse(error)
    return handleApiError(error, request)
  }
}

export async function DELETE(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const existing = await getNfseSettings(ctx.tenantId)
    if (existing) {
      await deleteNfseSettings(ctx.tenantId)
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'delete',
        entityType: 'nfse_settings',
        changes: { certificate: { old: existing.certificate, new: null } },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
