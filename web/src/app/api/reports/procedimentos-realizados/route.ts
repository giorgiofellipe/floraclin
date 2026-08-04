import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import {
  listProcedureApplications,
  type ProcedureApplicationRow,
  type ProcedureApplicationSortKey,
} from '@/db/queries/reports/procedimentos-realizados'
import { PROCEDURE_APPLICATION_COLUMNS } from '@/lib/reports/columns/procedimentos-realizados'
import { toCsv, csvFilename } from '@/lib/reports/csv'
import { getReport } from '@/lib/reports/registry'
import { resolveDateRange } from '@/lib/reports/date-range'
import { ReportPdf, REPORT_PDF_CSS } from '@/components/reports/report-pdf'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { brToday } from '@/lib/dates'
import { formatDate } from '@/lib/utils'

export const runtime = 'nodejs'
// Disable static optimization: the CSV/PDF branches render dynamic binary/text output.
export const dynamic = 'force-dynamic'

const REPORT_SLUG = 'procedimentos-realizados'

// The registry is the single source of truth for the default window width,
// so the seeded date inputs in the UI and this route's fallback cannot drift.
// Non-null: this report declares the `date-range` filter kind, so the
// registry always sets `defaultRangeDays` for it (see registry.test.ts).
const DEFAULT_RANGE_DAYS = getReport(REPORT_SLUG)!.defaultRangeDays!
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Allow-list of sort keys this report's query knows how to order by (see
// `ProcedureApplicationSortKey` in `@/db/queries/reports/procedimentos-realizados`).
const SORT_KEYS = ['performedAt', 'patientName', 'practitionerName', 'productName'] as const

type ParsedSort =
  | { ok: true; sort: { key: ProcedureApplicationSortKey; dir: 'asc' | 'desc' } | undefined }
  | { ok: false; error: string }

function parseSort(searchParams: URLSearchParams): ParsedSort {
  const sortParam = searchParams.get('sort')
  if (!sortParam) return { ok: true, sort: undefined }

  if (!(SORT_KEYS as readonly string[]).includes(sortParam)) {
    return { ok: false, error: 'Campo de ordenação inválido' }
  }

  const dirParam = searchParams.get('dir')
  if (dirParam !== null && dirParam !== 'asc' && dirParam !== 'desc') {
    return { ok: false, error: 'Direção de ordenação inválida' }
  }

  return {
    ok: true,
    sort: { key: sortParam as ProcedureApplicationSortKey, dir: dirParam === 'desc' ? 'desc' : 'asc' },
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner', 'financial')

    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)

    const { searchParams } = new URL(request.url)

    // A partial range is completed, not rejected; see `resolveDateRange`.
    const range = resolveDateRange(searchParams.get('dateFrom'), searchParams.get('dateTo'), {
      defaultRangeDays: DEFAULT_RANGE_DAYS,
    })
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 })
    }
    const { dateFrom, dateTo } = range

    const practitionerIdParam = searchParams.get('practitionerId')
    if (practitionerIdParam && !UUID_RE.test(practitionerIdParam)) {
      return NextResponse.json({ error: 'Profissional inválido' }, { status: 400 })
    }
    const practitionerId = practitionerIdParam ?? undefined

    const parsedSort = parseSort(searchParams)
    if (!parsedSort.ok) {
      return NextResponse.json({ error: parsedSort.error }, { status: 400 })
    }

    const rows = await listProcedureApplications(ctx.tenantId, {
      dateFrom,
      dateTo,
      practitionerId,
      sort: parsedSort.sort,
    })

    const format = searchParams.get('format')

    if (format === 'csv') {
      const csv = toCsv(rows, PROCEDURE_APPLICATION_COLUMNS)
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${csvFilename(REPORT_SLUG, brToday())}"`,
        },
      })
    }

    if (format === 'pdf') {
      const report = getReport(REPORT_SLUG)
      const pdf = await renderReactToPdf(
        // `ReportPdf` is generic; createElement can't infer `Row` from the
        // props object alone, so instantiate it explicitly (TS 4.7+ generic
        // instantiation expression) rather than widening to `unknown`.
        // `ReportPdf` always stamps a "Gerado em" (generated-at) timestamp
        // in the footer, which is what makes this export tamper-evident
        // enough to hand over if an application is ever questioned.
        createElement(ReportPdf<ProcedureApplicationRow>, {
          clinicName: tenant?.name ?? '',
          reportTitle: report?.title ?? 'Procedimentos realizados',
          filterSummary: `Período: ${formatDate(dateFrom)} a ${formatDate(dateTo)}`,
          rows,
          columns: PROCEDURE_APPLICATION_COLUMNS,
          generatedAt: new Date(),
        }),
        `${PRINT_BASE_CSS}${REPORT_PDF_CSS}`,
      )

      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${REPORT_SLUG}-${brToday()}.pdf"`,
        },
      })
    }

    return NextResponse.json({ data: rows })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
