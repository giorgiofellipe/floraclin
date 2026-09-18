import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getProcedure } from '@/db/queries/procedures'
import { createSigningToken, getTemplatesForToken } from '@/db/queries/consent-signing-tokens'
import { getActiveConsentForType } from '@/db/queries/consent'
import { sendSigningLinkSchema } from '@/validations/consent'
import { handleApiError } from '@/lib/api-error'
import { getAppUrl } from '@/lib/app-url'

interface ResolvedTemplates {
  consentTemplateIds: string[]
  renderedContents?: Record<string, string>
}

function keyedContents(
  source: Record<string, string> | undefined,
  keyOf: (templateId: string) => string,
  templateIds: string[],
): Record<string, string> | undefined {
  if (!source) return undefined
  const picked: Record<string, string> = {}
  for (const id of templateIds) {
    const content = source[keyOf(id)]
    if (content) picked[id] = content
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

async function resolveByIds(
  tenantId: string,
  requestedIds: string[],
  renderedContents: Record<string, string> | undefined,
): Promise<ResolvedTemplates | string> {
  const consentTemplateIds = [...new Set(requestedIds)]
  const templates = await getTemplatesForToken(tenantId, consentTemplateIds)
  if (templates.length !== consentTemplateIds.length) {
    return 'Modelo de termo não encontrado ou inativo'
  }
  return {
    consentTemplateIds,
    renderedContents: keyedContents(renderedContents, (id) => id, consentTemplateIds),
  }
}

async function resolveByTypes(
  tenantId: string,
  types: string[],
  renderedContents: Record<string, string> | undefined,
): Promise<ResolvedTemplates | string> {
  const uniqueTypes = [...new Set(types)]
  const resolved = await Promise.all(
    uniqueTypes.map(async (type) => ({ type, template: await getActiveConsentForType(tenantId, type) })),
  )
  const missing = resolved.filter((r) => !r.template).map((r) => r.type)
  if (missing.length > 0) {
    return `Nenhum modelo de termo ativo para: ${missing.join(', ')}`
  }

  const typeOf = new Map(resolved.map((r) => [r.template!.id, r.type]))
  const consentTemplateIds = [...typeOf.keys()]
  return {
    consentTemplateIds,
    renderedContents: keyedContents(renderedContents, (id) => typeOf.get(id)!, consentTemplateIds),
  }
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
    const data = parsed.data

    const tenant = await getTenant(ctx.tenantId)
    if (!tenant) {
      return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })
    }

    const patient = await getPatient(ctx.tenantId, data.patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    let procedureRecordId: string | null = null
    let resolved: ResolvedTemplates | string
    if ('consentTemplateIds' in data) {
      resolved = await resolveByIds(ctx.tenantId, data.consentTemplateIds, data.renderedContents)
    } else {
      const procedure = await getProcedure(ctx.tenantId, data.procedureRecordId)
      if (!procedure || procedure.patientId !== data.patientId) {
        return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
      }
      procedureRecordId = procedure.id
      resolved = await resolveByTypes(ctx.tenantId, data.consentTypes, data.renderedContents)
    }

    if (typeof resolved === 'string') {
      return NextResponse.json({ error: resolved }, { status: 400 })
    }

    const signingToken = await createSigningToken(
      ctx.tenantId,
      data.patientId,
      procedureRecordId,
      resolved.consentTemplateIds,
      ctx.userId,
      resolved.renderedContents,
    )

    return NextResponse.json({
      url: `${getAppUrl()}/sign/${signingToken.token}`,
      expiresAt: signingToken.expiresAt,
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
