import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { exportLedgerCSV } from '@/db/queries/cash-movements'
import {
  listLedgerReportRows,
  type LedgerReportRow,
  type LedgerReportSortKey,
} from '@/db/queries/reports/extrato-periodo'
import { LEDGER_REPORT_COLUMNS } from '@/lib/reports/columns/extrato-periodo'
import { csvFilename } from '@/lib/reports/csv'
import { getReport } from '@/lib/reports/registry'
import { ReportPdf, REPORT_PDF_CSS } from '@/components/reports/report-pdf'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { brToday } from '@/lib/dates'
import { formatDate } from '@/lib/utils'

export const runtime = 'nodejs'
// Disable static optimization: the CSV/PDF branches render dynamic binary/text output.
export const dynamic = 'force-dynamic'

const REPORT_SLUG = 'extrato-periodo'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Allow-list of sort keys this report's query knows how to order by (see
// `LedgerReportSortKey` in `@/db/queries/reports/extrato-periodo`).
const SORT_KEYS = ['movementDate', 'type', 'amount'] as const

type ParsedSort =
  | { ok: true; sort: { key: LedgerReportSortKey; dir: 'asc' | 'desc' } | undefined }
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
    sort: { key: sortParam as LedgerReportSortKey, dir: dirParam === 'desc' ? 'desc' : 'asc' },
  }
}

/**
 * Default window when neither `dateFrom` nor `dateTo` is sent: the current
 * BR calendar month to date, matching what `PractitionerPLView` seeds
 * client-side for the same underlying data. Built from `brToday()`'s
 * `YYYY-MM-DD` string via slicing, never from a bare `new Date()`, so it
 * can't drift a day on a UTC host.
 */
function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const today = brToday()
  return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today }
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
    const rawDateFrom = searchParams.get('dateFrom')
    const rawDateTo = searchParams.get('dateTo')

    let dateFrom: string
    let dateTo: string
    if (!rawDateFrom && !rawDateTo) {
      ;({ dateFrom, dateTo } = defaultDateRange())
    } else {
      if (!rawDateFrom || !DATE_RE.test(rawDateFrom) || !rawDateTo || !DATE_RE.test(rawDateTo)) {
        return NextResponse.json({ error: 'Datas inválidas' }, { status: 400 })
      }
      if (rawDateFrom > rawDateTo) {
        return NextResponse.json({ error: 'Data inicial posterior à data final' }, { status: 400 })
      }
      dateFrom = rawDateFrom
      dateTo = rawDateTo
    }

    const parsedSort = parseSort(searchParams)
    if (!parsedSort.ok) {
      return NextResponse.json({ error: parsedSort.error }, { status: 400 })
    }

    const format = searchParams.get('format')

    if (format === 'csv') {
      // Calls the pre-existing ledger export function directly, NOT the
      // generic toCsv(rows, columns) pipeline every other report uses, so
      // this file stays byte-compatible with what
      // `/api/financial/ledger/export` has always produced (see
      // web/src/db/queries/cash-movements.ts). That endpoint is untouched;
      // this is a second caller of the same function.
      const csv = await exportLedgerCSV(ctx.tenantId, { dateFrom, dateTo, type: 'all' })
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${csvFilename(REPORT_SLUG, brToday())}"`,
        },
      })
    }

    const rows = await listLedgerReportRows(ctx.tenantId, { dateFrom, dateTo, sort: parsedSort.sort })

    if (format === 'pdf') {
      const report = getReport(REPORT_SLUG)
      const pdf = await renderReactToPdf(
        // `ReportPdf` is generic; createElement can't infer `Row` from the
        // props object alone, so instantiate it explicitly (TS 4.7+ generic
        // instantiation expression) rather than widening to `unknown`.
        createElement(ReportPdf<LedgerReportRow>, {
          clinicName: tenant?.name ?? '',
          reportTitle: report?.title ?? 'Extrato por período',
          filterSummary: `Período: ${formatDate(dateFrom)} a ${formatDate(dateTo)}`,
          rows,
          columns: LEDGER_REPORT_COLUMNS,
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
