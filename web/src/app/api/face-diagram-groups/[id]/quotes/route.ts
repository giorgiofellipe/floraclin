import { NextResponse, type NextRequest } from 'next/server'
import { createElement } from 'react'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { getDiagramGroup, lockDiagramGroup } from '@/db/queries/face-diagram-groups'
import { createDiagramQuote, listDiagramQuotes } from '@/db/queries/face-diagram-quotes'
import { getPatient } from '@/db/queries/patients'
import { getTenantHeaderInfoForPdf } from '@/db/queries/tenants'
import { QuotePdf } from '@/components/face-diagram/quote-pdf'
import { DIAGRAM_PDF_CSS } from '@/components/face-diagram/diagram-pdf'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { deleteFile, getSignedUrl, getStoragePath, uploadPdfBuffer } from '@/lib/storage'
import { quoteTotal } from '@/lib/diagram-quote'
import { isOpenDiagram } from '@/lib/face-diagram-status'
import { EMPTY_TENANT_HEADER } from '@/lib/tenant-header'
import { handleApiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const { id } = await params
    const snapshot = await withTransaction(async (tx) => {
      const locked = await lockDiagramGroup(tx, ctx.tenantId, id)
      if (!locked) return { error: 'not_found' as const }
      if (!isOpenDiagram(locked.status)) return { error: 'not_quote' as const }
      const group = await getDiagramGroup(ctx.tenantId, id, tx)
      return group ? { group } : { error: 'not_found' as const }
    })
    if ('error' in snapshot) {
      return snapshot.error === 'not_found'
        ? NextResponse.json({ error: 'Diagrama não encontrado' }, { status: 404 })
        : NextResponse.json({ error: 'Este diagrama não está mais como orçamento' }, { status: 409 })
    }
    const { group } = snapshot
    if (group.quotationLines.length === 0) {
      return NextResponse.json(
        { error: 'Adicione ao menos um procedimento ao orçamento' },
        { status: 400 },
      )
    }

    const patient = await getPatient(ctx.tenantId, group.patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const lines = group.quotationLines.map((l) => ({ ...l }))
    const total = quoteTotal(lines)
    const tenant = (await getTenantHeaderInfoForPdf(ctx.tenantId)) ?? EMPTY_TENANT_HEADER

    const pdf = await renderReactToPdf(
      createElement(QuotePdf, {
        tenant,
        patient: { fullName: patient.fullName, gender: patient.gender },
        group,
        lines,
        total,
        generatedAt: new Date(),
      }),
      PRINT_BASE_CSS + DIAGRAM_PDF_CSS,
    )

    const quoteId = crypto.randomUUID()
    const fileName = `quotes/${quoteId}.pdf`
    const path = getStoragePath(ctx.tenantId, group.patientId, fileName)
    let url: string
    try {
      const upload = await uploadPdfBuffer({
        tenantId: ctx.tenantId,
        patientId: group.patientId,
        fileName,
        buffer: pdf,
        visibility: 'signed',
      })
      url = upload.url
      await withTransaction(async (tx) => {
        await createDiagramQuote(tx, {
          id: quoteId,
          tenantId: ctx.tenantId,
          patientId: group.patientId,
          groupId: group.id,
          storagePath: path,
          lines,
          total,
          createdBy: ctx.userId,
        })
        await createAuditLog(
          {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            action: 'create',
            entityType: 'face_diagram_quote',
            entityId: quoteId,
            changes: { total: { old: null, new: total } },
          },
          tx,
        )
      })
    } catch (error) {
      await deleteFile(path).catch(() => undefined)
      throw error
    }

    return NextResponse.json({ data: { id: quoteId, url } })
  } catch (error) {
    return handleApiError(error, req, { body: { error: 'Falha ao gerar orçamento' } })
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    if (!(await getDiagramGroup(ctx.tenantId, id))) {
      return NextResponse.json({ error: 'Diagrama não encontrado' }, { status: 404 })
    }
    const quotes = await listDiagramQuotes(ctx.tenantId, id)
    const data = await Promise.all(
      quotes.map(async (q) => ({
        ...q,
        url: await getSignedUrl(q.storagePath, 3600, 'orcamento.pdf'),
      })),
    )
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, req)
  }
}
