import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { createStorageClient } from '@/lib/supabase/storage-client'
import { handleApiError } from '@/lib/api-error'

const BUCKET_NAME = 'floraclin'
const MAX_LOGO_BYTES = 1 * 1024 * 1024 // 1 MB — logos render at 64-128px, anything bigger is wasted bandwidth
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const
// Signed URL TTL for the logo. Long enough that operators don't have to
// re-sign in normal use; if it ever expires the operator can re-upload.
const LOGO_SIGNED_URL_TTL = 60 * 60 * 24 * 365 // 1 year

function mimeToExt(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  return 'svg' // svg+xml
}

/**
 * Uploads (or replaces) the tenant's logo image. The image is stored
 * privately in the `floraclin` bucket under `<tenantId>/branding/`, and
 * a long-lived signed URL is persisted on `tenants.logo_url` so server-
 * rendered `<ClinicHeader>` (print pages, PDF generation, public booking
 * page) can just consume `tenant.logoUrl` like any other URL.
 *
 * Owner-only. New uploads write to a new random filename so previous
 * print/PDF copies that captured a snapshot of the prior URL keep
 * working until the signed URL expires.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
    }
    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json(
        { error: 'Logo muito grande. Máximo 1 MB.' },
        { status: 413 },
      )
    }
    if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
      return NextResponse.json(
        { error: 'Formato não suportado. Use PNG, JPG, WebP ou SVG.' },
        { status: 415 },
      )
    }

    const supabase = createStorageClient()
    const fileId = randomUUID()
    const ext = mimeToExt(file.type)
    const path = `${ctx.tenantId}/branding/logo-${fileId}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(path, file, {
        contentType: file.type,
        cacheControl: '604800', // 7 days — cdn/browser cache
        upsert: false,
      })
    if (uploadError) {
      return NextResponse.json(
        { error: `Falha ao enviar logo: ${uploadError.message}` },
        { status: 500 },
      )
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(path, LOGO_SIGNED_URL_TTL)
    if (signError || !signed?.signedUrl) {
      return NextResponse.json(
        { error: 'Logo enviado mas falha ao gerar URL pública' },
        { status: 500 },
      )
    }

    await db
      .update(tenants)
      .set({ logoUrl: signed.signedUrl, updatedAt: new Date() })
      .where(eq(tenants.id, ctx.tenantId))

    // Audit only a hash of the file — the URL itself is just a signed path
    // and would bloat the log without adding forensic value.
    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'tenant',
      entityId: ctx.tenantId,
      changes: {
        logo: {
          old: null,
          new: {
            storagePath: path,
            mimeType: file.type,
            sizeBytes: file.size,
            sha256: createHash('sha256').update(await file.arrayBuffer().then(Buffer.from)).digest('hex'),
          },
        },
      },
    })

    return NextResponse.json({ success: true, logoUrl: signed.signedUrl })
  } catch (error) {
    return handleApiError(error, request)
  }
}

/**
 * Clears the tenant's logo. Does NOT remove the underlying file from
 * storage — re-pointing or re-uploading is cheap, and keeping orphaned
 * files is fine for now. (A scheduled cleanup pass can sweep them.)
 */
export async function DELETE(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await db
      .update(tenants)
      .set({ logoUrl: null, updatedAt: new Date() })
      .where(eq(tenants.id, ctx.tenantId))
    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'tenant',
      entityId: ctx.tenantId,
      changes: { logo: { old: 'set', new: null } },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
