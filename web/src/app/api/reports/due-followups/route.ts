import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import {
  listDueFollowUps,
  type DueFollowUpRow,
  type DueFollowUpSortKey,
} from '@/db/queries/reports/due-followups'
import { DUE_FOLLOWUP_COLUMNS } from '@/lib/reports/columns/due-followups'
import { toCsv, csvFilename } from '@/lib/reports/csv'
import { getReport } from '@/lib/reports/registry'
import { ReportPdf, REPORT_PDF_CSS } from '@/components/reports/report-pdf'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { brToday } from '@/lib/dates'

export const runtime = 'nodejs'
// Disable static optimization: the CSV/PDF branches render dynamic binary/text output.
export const dynamic = 'force-dynamic'

const REPORT_SLUG = 'retornos'

// The registry is the single source of truth for this report's default day
// count, so the UI filter and this route can never disagree.
const DEFAULT_WINDOW_DAYS = getReport(REPORT_SLUG)!.defaultDays
const MAX_WINDOW_DAYS = 3650
const WINDOW_RE = /^\d+$/

// Allow-list of sort keys this report's query knows how to order by (see
// `DueFollowUpSortKey` in `@/db/queries/reports/due-followups`). An
// unrecognized `sort` value is rejected with 400 rather than silently
// ignored or passed through to a query string.
const SORT_KEYS = ['fullName', 'followUpDate', 'daysUntil'] as const

type ParsedSort =
  | { ok: true; sort: { key: DueFollowUpSortKey; dir: 'asc' | 'desc' } | undefined }
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
    sort: { key: sortParam as DueFollowUpSortKey, dir: dirParam === 'desc' ? 'desc' : 'asc' },
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
    const windowParam = searchParams.get('windowDays')

    let windowDays: number
    if (windowParam === null || windowParam.trim() === '') {
      windowDays = DEFAULT_WINDOW_DAYS
    } else {
      // Reject anything that isn't a plain non-negative integer rather than
      // coercing it: Number('abc') is NaN (caught below), but Number('-5')
      // and Number('1e400') would otherwise sneak through a bare Number() cast.
      if (!WINDOW_RE.test(windowParam)) {
        return NextResponse.json({ error: 'Janela de dias inválida' }, { status: 400 })
      }
      const parsed = Number(windowParam)
      if (parsed > MAX_WINDOW_DAYS) {
        return NextResponse.json({ error: 'Janela de dias inválida' }, { status: 400 })
      }
      windowDays = parsed
    }

    const parsedSort = parseSort(searchParams)
    if (!parsedSort.ok) {
      return NextResponse.json({ error: parsedSort.error }, { status: 400 })
    }

    const today = new Date()
    const rows = await listDueFollowUps(ctx.tenantId, {
      windowDays,
      today,
      sort: parsedSort.sort,
    })

    const format = searchParams.get('format')

    if (format === 'csv') {
      const csv = toCsv(rows, DUE_FOLLOWUP_COLUMNS)
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
        createElement(ReportPdf<DueFollowUpRow>, {
          clinicName: tenant?.name ?? '',
          reportTitle: report?.title ?? 'Retornos a vencer',
          filterSummary: `Janela: ${windowDays} dias`,
          rows,
          columns: DUE_FOLLOWUP_COLUMNS,
          generatedAt: today,
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
