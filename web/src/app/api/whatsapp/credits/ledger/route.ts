import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { decodeLedgerCursor, listCreditPeriods, listLedgerEntries } from '@/db/queries/whatsapp-credit-history'
import type { LedgerPage } from '@/lib/whatsapp-credit-ledger'

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const { searchParams } = new URL(request.url)

    const rawPeriod = searchParams.get('periodId')
    if (rawPeriod && !z.string().uuid().safeParse(rawPeriod).success) {
      return NextResponse.json({ error: 'Período inválido' }, { status: 400 })
    }
    const rawCursor = searchParams.get('cursor')
    const cursor = rawCursor ? decodeLedgerCursor(rawCursor) : null
    if (rawCursor && !cursor) {
      return NextResponse.json({ error: 'Cursor inválido' }, { status: 400 })
    }

    const periods = await listCreditPeriods(ctx.tenantId)
    const periodId = rawPeriod ?? periods[0]?.id
    if (!periodId) {
      const empty: LedgerPage = { periods, periodId: null, entries: [], nextCursor: null }
      return NextResponse.json(empty)
    }
    if (!periods.some((p) => p.id === periodId)) {
      return NextResponse.json({ error: 'Período não encontrado' }, { status: 404 })
    }

    const { entries, nextCursor } = await listLedgerEntries(ctx.tenantId, periodId, cursor)
    const page: LedgerPage = { periods, periodId, entries, nextCursor }
    return NextResponse.json(page)
  } catch (error) {
    return handleApiError(error, request)
  }
}
