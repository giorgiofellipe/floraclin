import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listSystemTemplates } from '@/db/queries/whatsapp'
import { isWhatsAppEnabled } from '@/lib/whatsapp'
import { handleApiError } from '@/lib/api-error'

/**
 * Read-only listing of the platform-managed templates. Clinics on the shared
 * FloraClin number can't manage templates, but they still need to see the
 * exact message their patients receive, so this serves the same rows the send
 * path resolves through getSystemTemplate, plus the clinic name that fills
 * the clinic_name variable in the preview.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null

    if (!isWhatsAppEnabled(settings)) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }

    const allowedRoles = (settings?.whatsapp_allowed_roles as string[]) ?? ['owner']
    if (!allowedRoles.includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const templates = await listSystemTemplates()
    return NextResponse.json({ data: templates, clinicName: tenant!.name })
  } catch (error) {
    return handleApiError(error, request)
  }
}
