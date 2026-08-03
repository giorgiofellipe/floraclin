import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { listRepeatNoShows, type RepeatNoShowRow } from '@/db/queries/reports/repeat-no-shows'
import { REPEAT_NO_SHOW_COLUMNS } from '@/lib/reports/columns/repeat-no-shows'
import { toCsv, csvFilename } from '@/lib/reports/csv'
import { getReport } from '@/lib/reports/registry'
import { ReportPdf, REPORT_PDF_CSS } from '@/components/reports/report-pdf'
import { renderReactToPdf, PRINT_BASE_CSS } from '@/lib/pdf'
import { brToday } from '@/lib/dates'

export const runtime = 'nodejs'
// Disable static optimization: the CSV/PDF branches render dynamic binary/text output.
export const dynamic = 'force-dynamic'

const DEFAULT_WINDOW_DAYS = 180
const MAX_WINDOW_DAYS = 3650
const DEFAULT_MIN_COUNT = 2
const MAX_MIN_COUNT = 1000
const INTEGER_RE = /^\d+$/

const REPORT_SLUG = 'faltas'

/**
 * Parses a non-negative integer query param strictly: rejects anything that
 * isn't a plain digit string (no coercion of "-5", "1e400", "abc", etc) and
 * caps it at `max`. Returns `null` when invalid so the caller can 400.
 */
function parseStrictInt(raw: string, max: number): number | null {
  if (!INTEGER_RE.test(raw)) return null
  const parsed = Number(raw)
  if (parsed > max) return null
  return parsed
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
    const minCountParam = searchParams.get('minCount')

    let windowDays: number
    if (windowParam === null || windowParam.trim() === '') {
      windowDays = DEFAULT_WINDOW_DAYS
    } else {
      const parsed = parseStrictInt(windowParam, MAX_WINDOW_DAYS)
      if (parsed === null) {
        return NextResponse.json({ error: 'Janela de dias inválida' }, { status: 400 })
      }
      windowDays = parsed
    }

    let minCount: number
    if (minCountParam === null || minCountParam.trim() === '') {
      minCount = DEFAULT_MIN_COUNT
    } else {
      const parsed = parseStrictInt(minCountParam, MAX_MIN_COUNT)
      if (parsed === null) {
        return NextResponse.json({ error: 'Quantidade mínima inválida' }, { status: 400 })
      }
      minCount = parsed
    }

    const today = new Date()
    const rows = await listRepeatNoShows(ctx.tenantId, { windowDays, minCount, today })

    const format = searchParams.get('format')

    if (format === 'csv') {
      const csv = toCsv(rows, REPEAT_NO_SHOW_COLUMNS)
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
        createElement(ReportPdf<RepeatNoShowRow>, {
          clinicName: tenant?.name ?? '',
          reportTitle: report?.title ?? 'Faltas recorrentes',
          filterSummary: `Janela: ${windowDays} dias · Mínimo de faltas: ${minCount}`,
          rows,
          columns: REPEAT_NO_SHOW_COLUMNS,
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
