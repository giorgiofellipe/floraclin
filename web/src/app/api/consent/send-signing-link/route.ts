import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { createSigningToken, getTemplatesForToken } from '@/db/queries/consent-signing-tokens'
import { getActiveConsentForType } from '@/db/queries/consent'
import { sendSigningLinkSchema, type SendSigningLinkInput } from '@/validations/consent'
import { handleApiError } from '@/lib/api-error'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

interface ResolvedTemplates {
  consentTemplateIds: string[]
  renderedContents?: Record<string, string>
}

async function resolveByIds(
  tenantId: string,
  requestedIds: string[],
  renderedContents: Record<string, string> | undefined,
): Promise<ResolvedTemplates | null> {
  const consentTemplateIds = [...new Set(requestedIds)]
  const templates = await getTemplatesForToken(tenantId, consentTemplateIds)
  if (templates.length !== consentTemplateIds.length) return null

  const rendered = pickKeys(renderedContents, consentTemplateIds)
  return { consentTemplateIds, renderedContents: rendered }
}

async function resolveByTypes(
  tenantId: string,
  types: NonNullable<SendSigningLinkInput['consentTypes']>,
  renderedContents: Record<string, string> | undefined,
): Promise<ResolvedTemplates | null> {
  const templateResults = await Promise.all(
    types.map(async (type) => {
      const tpl = await getActiveConsentForType(tenantId, type)
      return tpl ? { type, id: tpl.id } : null
    }),
  )
  const resolved = templateResults.filter((t): t is NonNullable<typeof t> => t !== null)
  if (resolved.length === 0) return null

  // The caller keys rendered contents by type; the token keys them by template id.
  let rendered: Record<string, string> | undefined
  if (renderedContents) {
    rendered = {}
    for (const r of resolved) {
      const content = renderedContents[r.type]
      if (content) rendered[r.id] = content
    }
    if (Object.keys(rendered).length === 0) rendered = undefined
  }

  return { consentTemplateIds: resolved.map((t) => t.id), renderedContents: rendered }
}

function pickKeys(
  source: Record<string, string> | undefined,
  keys: string[],
): Record<string, string> | undefined {
  if (!source) return undefined
  const picked: Record<string, string> = {}
  for (const key of keys) {
    if (source[key]) picked[key] = source[key]
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

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

    const resolved = parsed.data.consentTemplateIds
      ? await resolveByIds(ctx.tenantId, parsed.data.consentTemplateIds, parsed.data.renderedContents)
      : await resolveByTypes(ctx.tenantId, parsed.data.consentTypes!, parsed.data.renderedContents)

    if (!resolved) {
      return NextResponse.json(
        { error: 'Nenhum modelo de termo ativo encontrado para a solicitação' },
        { status: 400 },
      )
    }

    const signingToken = await createSigningToken(
      ctx.tenantId,
      parsed.data.patientId,
      parsed.data.procedureRecordId ?? null,
      resolved.consentTemplateIds,
      ctx.userId,
      resolved.renderedContents,
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
