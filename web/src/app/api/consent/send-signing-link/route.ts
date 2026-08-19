import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { createSigningToken } from '@/db/queries/consent-signing-tokens'
import { getActiveConsentForType } from '@/db/queries/consent'
import { sendSigningLinkSchema } from '@/validations/consent'
import { handleApiError } from '@/lib/api-error'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = sendSigningLinkSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const tenant = await getTenant(ctx.tenantId)
    if (!tenant) {
      return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })
    }

    const patient = await getPatient(ctx.tenantId, parsed.data.patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    // Resolve consent types to active template IDs server-side
    const templateResults = await Promise.all(
      parsed.data.consentTypes.map(async (type) => {
        const tpl = await getActiveConsentForType(ctx.tenantId, type)
        return tpl ? { type, id: tpl.id } : null
      }),
    )
    const resolved = templateResults.filter((t): t is NonNullable<typeof t> => t !== null)
    const consentTemplateIds = resolved.map((t) => t.id)

    if (consentTemplateIds.length === 0) {
      return NextResponse.json({ error: 'Nenhum modelo de termo encontrado para os tipos solicitados' }, { status: 400 })
    }

    // Map rendered contents from type keys to template ID keys
    let renderedContents: Record<string, string> | undefined
    if (parsed.data.renderedContents) {
      renderedContents = {}
      for (const r of resolved) {
        const content = parsed.data.renderedContents[r.type]
        if (content) renderedContents[r.id] = content
      }
      if (Object.keys(renderedContents).length === 0) renderedContents = undefined
    }

    const signingToken = await createSigningToken(
      ctx.tenantId,
      parsed.data.patientId,
      parsed.data.procedureRecordId,
      consentTemplateIds,
      ctx.userId,
      renderedContents,
    )

    const url = `${appUrl}/sign/${signingToken.token}`

    return NextResponse.json({
      url,
      expiresAt: signingToken.expiresAt,
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
