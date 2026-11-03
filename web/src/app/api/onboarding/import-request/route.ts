import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { handleApiError } from '@/lib/api-error'
import { clearImportHelpRequest, markImportHelpRequested } from '@/db/queries/tenants'
import { sendDiscordNow } from '@/lib/discord'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked
    // A platform admin resolves as owner in any clinic; the request is the clinic owner's to make.
    if (ctx.isPlatformAdmin) {
      return NextResponse.json({ error: 'Apenas o dono da clínica pode pedir a importação.' }, { status: 403 })
    }

    const result = await markImportHelpRequested(ctx.tenantId)
    if (!result) return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })

    if (result.first) {
      const delivered = await sendDiscordNow({
        kind: 'onboarding.import_requested',
        tenantId: ctx.tenantId,
        tenantName: result.tenantName,
        phone: result.phone,
        ownerEmail: ctx.email,
      })
      if (!delivered) {
        await clearImportHelpRequest(ctx.tenantId, result.requestedAt)
        return NextResponse.json({ error: 'Não foi possível enviar agora. Tente de novo.' }, { status: 502 })
      }
    }

    return NextResponse.json({ requestedAt: result.requestedAt })
  } catch (error) {
    return handleApiError(error, request)
  }
}
