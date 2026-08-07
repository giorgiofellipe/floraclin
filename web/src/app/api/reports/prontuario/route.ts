import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { getPatientDossier, toProntuarioSummary } from '@/db/queries/reports/prontuario'
import { ProntuarioPdf, PRONTUARIO_PDF_CSS } from '@/components/reports/prontuario-pdf'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { reportRouteError } from '@/lib/reports/api-error'

export const runtime = 'nodejs'
// Disable static optimization: the PDF branch renders dynamic binary output.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "Prontuário completo" (report 3.1). Unlike every other report under
 * `/api/reports`, this one is per-patient, not a filtered table: it always
 * requires a `patientId` and never dumps every patient in the tenant.
 *
 * No `?format=csv`: a single patient's clinical record does not have a
 * sensible row-per-line shape, so this route only ever serves JSON (the
 * on-screen summary) or `?format=pdf` (the document). A request for
 * `format=csv` is rejected with 400 rather than silently falling back to
 * JSON, so the UI never offers (nor pretends to serve) a broken export.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner', 'financial')

    const { searchParams } = new URL(request.url)

    const patientId = searchParams.get('patientId')
    if (!patientId) {
      return NextResponse.json({ error: 'Selecione um paciente' }, { status: 400 })
    }
    if (!UUID_RE.test(patientId)) {
      return NextResponse.json({ error: 'Paciente inválido' }, { status: 400 })
    }

    const format = searchParams.get('format')
    if (format === 'csv') {
      return NextResponse.json(
        { error: 'Exportação em CSV não está disponível para o prontuário; use o PDF.' },
        { status: 400 },
      )
    }

    const dossier = await getPatientDossier(ctx.tenantId, patientId)
    if (!dossier) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    if (format === 'pdf') {
      const [tenant] = await db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)

      const pdf = await renderReactToPdf(
        createElement(ProntuarioPdf, {
          clinicName: tenant?.name ?? '',
          dossier,
          generatedAt: new Date(),
        }),
        `${PRINT_BASE_CSS}${PRONTUARIO_PDF_CSS}`,
      )

      const filenameSafeName = dossier.patient.fullName
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()

      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="prontuario-${filenameSafeName || patientId}.pdf"`,
        },
      })
    }

    // Only the JSON branch is projected down to a summary; the PDF branch
    // above keeps rendering from the full `dossier`. See `toProntuarioSummary`
    // for why: the on-screen summary page only ever renders counters and a
    // few procedure lines, so the full dossier (every consent's signature
    // data, every photo's signed URL, every diagram point) has no business
    // reaching the browser here.
    return NextResponse.json({ data: toProntuarioSummary(dossier) })
  } catch (error) {
    return reportRouteError(error, request)
  }
}
