import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { requireRole } from '@/lib/auth'
import { getTenantHeaderInfo } from '@/db/queries/tenants'
import { exportLedgerCSV } from '@/db/queries/cash-movements'
import {
  listLedgerReportRows,
  type LedgerReportRow,
  type LedgerReportSortKey,
} from '@/db/queries/reports/extrato-periodo'
import { LEDGER_REPORT_COLUMNS } from '@/lib/reports/columns/extrato-periodo'
import { csvFilename } from '@/lib/reports/csv'
import { getReport } from '@/lib/reports/registry'
import { resolveDateRange } from '@/lib/reports/date-range'
import { ReportPdf, REPORT_PDF_CSS } from '@/components/reports/report-pdf'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { brToday } from '@/lib/dates'
import { formatDate } from '@/lib/utils'
import { reportRouteError } from '@/lib/reports/api-error'

export const runtime = 'nodejs'
// Disable static optimization: the CSV/PDF branches render dynamic binary/text output.
export const dynamic = 'force-dynamic'

const REPORT_SLUG = 'extrato-periodo'

// The registry is the single source of truth for the default window width,
// so the seeded date inputs in the UI and this route's fallback cannot drift.
// Non-null: this report declares the `date-range` filter kind, so the
// registry always sets `defaultRangeDays` for it (see registry.test.ts).
const DEFAULT_RANGE_DAYS = getReport(REPORT_SLUG)!.defaultRangeDays!

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

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner', 'financial')

    const tenant = await getTenantHeaderInfo(ctx.tenantId)

    const { searchParams } = new URL(request.url)

    // A partial range is completed, not rejected; see `resolveDateRange`.
    const range = resolveDateRange(searchParams.get('dateFrom'), searchParams.get('dateTo'), {
      defaultRangeDays: DEFAULT_RANGE_DAYS,
    })
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 })
    }
    const { dateFrom, dateTo } = range

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
          tenant: tenant ?? { name: '', phone: null, email: null, logoUrl: null, address: null },
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
    return reportRouteError(error, request)
  }
}
