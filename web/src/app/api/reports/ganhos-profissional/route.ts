import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { requireRole } from '@/lib/auth'
import { getTenantHeaderInfoForPdf } from '@/db/queries/tenants'
import { EMPTY_TENANT_HEADER } from '@/lib/tenant-header'
import {
  listPractitionerEarnings,
  type PractitionerPLRow,
  type PractitionerEarningsSortKey,
} from '@/db/queries/reports/ganhos-profissional'
import { PRACTITIONER_EARNINGS_COLUMNS } from '@/lib/reports/columns/ganhos-profissional'
import { toCsv, csvFilename } from '@/lib/reports/csv'
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

const REPORT_SLUG = 'ganhos-profissional'

// The registry is the single source of truth for the default window width,
// so the seeded date inputs in the UI and this route's fallback cannot drift.
// Non-null: this report declares the `date-range` filter kind, so the
// registry always sets `defaultRangeDays` for it (see registry.test.ts).
const DEFAULT_RANGE_DAYS = getReport(REPORT_SLUG)!.defaultRangeDays!
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Allow-list of sort keys this report's query knows how to order by (see
// `PractitionerEarningsSortKey` in `@/db/queries/reports/ganhos-profissional`).
const SORT_KEYS = ['practitionerName', 'procedureCount', 'revenueGenerated', 'revenueCollected'] as const

type ParsedSort =
  | { ok: true; sort: { key: PractitionerEarningsSortKey; dir: 'asc' | 'desc' } | undefined }
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
    sort: { key: sortParam as PractitionerEarningsSortKey, dir: dirParam === 'desc' ? 'desc' : 'asc' },
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner', 'financial')

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

    const rows = await listPractitionerEarnings(ctx.tenantId, {
      dateFrom,
      dateTo,
      practitionerId,
      sort: parsedSort.sort,
    })

    const format = searchParams.get('format')

    if (format === 'csv') {
      const csv = toCsv(rows, PRACTITIONER_EARNINGS_COLUMNS)
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${csvFilename(REPORT_SLUG, brToday())}"`,
        },
      })
    }

    if (format === 'pdf') {
      const tenant = await getTenantHeaderInfoForPdf(ctx.tenantId)
      const report = getReport(REPORT_SLUG)
      const pdf = await renderReactToPdf(
        // `ReportPdf` is generic; createElement can't infer `Row` from the
        // props object alone, so instantiate it explicitly (TS 4.7+ generic
        // instantiation expression) rather than widening to `unknown`.
        createElement(ReportPdf<PractitionerPLRow>, {
          tenant: tenant ?? EMPTY_TENANT_HEADER,
          reportTitle: report?.title ?? 'Ganhos por profissional',
          filterSummary: `Período: ${formatDate(dateFrom)} a ${formatDate(dateTo)}`,
          rows,
          columns: PRACTITIONER_EARNINGS_COLUMNS,
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
