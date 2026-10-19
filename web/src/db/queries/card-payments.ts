import { db } from '@/db/client'
import {
  cardPayments,
  cardRepasses,
  cardTerminals,
  cashMovements,
  patients,
  paymentRecords,
} from '@/db/schema'
import { and, asc, count, eq, gte, inArray, isNull, lte, ne, sql, sum } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { brToday, parseBrDate, toBrYmd } from '@/lib/dates'
import { createAuditLog } from '@/lib/audit'
import { BusinessError } from '@/lib/errors'
import {
  buildCardSchedule,
  cardInstallmentCountFor,
  toCardTerminalTerms,
  type CardMethod,
  type CardPaymentSummary,
  type CardTerminalTerms,
} from '@/lib/financial/card-repasses'

export interface CardPaymentRequest {
  terminalId: string
  method: CardMethod
  installmentCount: number
  expectedRate: number
}

export interface CardRepasseListRow {
  id: string
  cardPaymentId: string
  sequence: number
  expectedDate: string
  terminalName: string
  patientId: string
  patientName: string
  method: string
  grossAmount: string
  feeAmount: string
  netAmount: string
  status: string
  receivedAt: Date | null
  cardPaymentReversed: boolean
}

const DESCRIPTION_MAX = 255

const toCents = (value: number | string) => Math.round(Number(value) * 100)
const centsToDecimal = (cents: number) => (cents / 100).toFixed(2)

export function repasseLedgerDescription(prefix: string, rest: string): string {
  const full = `${prefix}${rest}`
  return full.length <= DESCRIPTION_MAX ? full : `${full.slice(0, DESCRIPTION_MAX - 1)}…`
}

export async function getCardTerminalTerms(
  tx: typeof db,
  tenantId: string,
  terminalId: string,
): Promise<{ id: string; name: string; terms: CardTerminalTerms }> {
  const [row] = await tx
    .select({
      id: cardTerminals.id,
      name: cardTerminals.name,
      debitRate: cardTerminals.debitRate,
      debitPayoutDays: cardTerminals.debitPayoutDays,
      creditRates: cardTerminals.creditRates,
      creditPayoutMode: cardTerminals.creditPayoutMode,
      creditLumpSumDays: cardTerminals.creditLumpSumDays,
    })
    .from(cardTerminals)
    .where(
      and(
        eq(cardTerminals.id, terminalId),
        eq(cardTerminals.tenantId, tenantId),
        isNull(cardTerminals.deletedAt),
      ),
    )
    .limit(1)

  if (!row) throw new BusinessError('CARD_TERMINAL_NOT_FOUND', 'Maquininha não encontrada')

  return {
    id: row.id,
    name: row.name,
    terms: toCardTerminalTerms(row),
  }
}

export async function createCardPaymentTx(
  tx: typeof db,
  tenantId: string,
  userId: string,
  input: CardPaymentRequest & { gross: number; paidAt: Date; patientId: string; description: string },
): Promise<{ cardPaymentId: string }> {
  const terminal = await getCardTerminalTerms(tx, tenantId, input.terminalId)
  const schedule = buildCardSchedule({
    gross: input.gross,
    method: input.method,
    installmentCount: input.installmentCount,
    terms: terminal.terms,
    paymentYmd: toBrYmd(input.paidAt),
  })

  if (Math.round(schedule.rate * 100) !== Math.round(input.expectedRate * 100)) {
    throw new BusinessError(
      'CARD_RATE_CHANGED',
      'A taxa da maquininha mudou desde que a tela foi aberta. Confira o novo valor e confirme novamente.',
    )
  }

  const [payment] = await tx
    .insert(cardPayments)
    .values({
      tenantId,
      cardTerminalId: terminal.id,
      patientId: input.patientId,
      method: input.method,
      installmentCount: cardInstallmentCountFor(input.method, input.installmentCount),
      rate: schedule.rate.toFixed(2),
      payoutMode: schedule.payoutMode,
      grossAmount: schedule.grossAmount.toFixed(2),
      feeAmount: schedule.feeAmount.toFixed(2),
      netAmount: schedule.netAmount.toFixed(2),
      description: input.description,
      paidAt: input.paidAt,
      createdBy: userId,
    })
    .returning({ id: cardPayments.id })

  await tx.insert(cardRepasses).values(
    schedule.repasses.map((r) => ({
      tenantId,
      cardPaymentId: payment.id,
      sequence: r.sequence,
      expectedDate: r.expectedDate,
      grossAmount: r.grossAmount.toFixed(2),
      feeAmount: r.feeAmount.toFixed(2),
      netAmount: r.netAmount.toFixed(2),
    })),
  )

  await postDueRepassesTx(tx, tenantId, { todayYmd: brToday(), cardPaymentId: payment.id })

  return { cardPaymentId: payment.id }
}

export async function postDueRepassesTx(
  tx: typeof db,
  tenantId: string,
  opts: { todayYmd: string; cardPaymentId?: string },
): Promise<number> {
  const conditions = [
    eq(cardRepasses.tenantId, tenantId),
    eq(cardRepasses.status, 'pending'),
    lte(cardRepasses.expectedDate, opts.todayYmd),
    isNull(cardPayments.reversedAt),
  ]
  if (opts.cardPaymentId) conditions.push(eq(cardRepasses.cardPaymentId, opts.cardPaymentId))

  const due = await tx
    .select({
      id: cardRepasses.id,
      cardPaymentId: cardRepasses.cardPaymentId,
      sequence: cardRepasses.sequence,
      expectedDate: cardRepasses.expectedDate,
      netAmount: cardRepasses.netAmount,
      patientId: cardPayments.patientId,
      createdBy: cardPayments.createdBy,
      description: cardPayments.description,
      method: cardPayments.method,
      terminalName: cardTerminals.name,
    })
    .from(cardRepasses)
    .innerJoin(
      cardPayments,
      and(eq(cardPayments.id, cardRepasses.cardPaymentId), eq(cardPayments.tenantId, tenantId)),
    )
    .innerJoin(
      cardTerminals,
      and(eq(cardTerminals.id, cardPayments.cardTerminalId), eq(cardTerminals.tenantId, tenantId)),
    )
    .where(and(...conditions))
    .orderBy(asc(cardRepasses.id))
    .for('update', { of: [cardRepasses, cardPayments], skipLocked: true })

  if (due.length === 0) return 0

  const totals = await tx
    .select({ cardPaymentId: cardRepasses.cardPaymentId, total: count() })
    .from(cardRepasses)
    .where(
      and(
        eq(cardRepasses.tenantId, tenantId),
        inArray(cardRepasses.cardPaymentId, [...new Set(due.map((r) => r.cardPaymentId))]),
      ),
    )
    .groupBy(cardRepasses.cardPaymentId)
  const totalByPayment = new Map(totals.map((t) => [t.cardPaymentId, Number(t.total)]))

  for (const repasse of due) {
    const [movement] = await tx
      .insert(cashMovements)
      .values({
        tenantId,
        type: 'inflow',
        amount: repasse.netAmount,
        description: repasseLedgerDescription(
          `Repasse ${repasse.terminalName} ${repasse.sequence}/${totalByPayment.get(repasse.cardPaymentId) ?? repasse.sequence}: `,
          repasse.description,
        ),
        paymentMethod: repasse.method,
        movementDate: parseBrDate(repasse.expectedDate, '12:00:00'),
        patientId: repasse.patientId,
        recordedBy: repasse.createdBy,
        cardRepasseId: repasse.id,
      })
      .returning({ id: cashMovements.id })

    const claimed = await tx
      .update(cardRepasses)
      .set({ status: 'received', receivedAt: new Date(), cashMovementId: movement.id, updatedAt: new Date() })
      .where(
        and(
          eq(cardRepasses.id, repasse.id),
          eq(cardRepasses.tenantId, tenantId),
          eq(cardRepasses.status, 'pending'),
        ),
      )
      .returning({ id: cardRepasses.id })

    if (claimed.length === 0) throw new Error(`Repasse ${repasse.id} was claimed concurrently`)
  }

  return due.length
}

export async function listTenantsWithDueRepasses(todayYmd: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ tenantId: cardRepasses.tenantId })
    .from(cardRepasses)
    .innerJoin(cardPayments, eq(cardPayments.id, cardRepasses.cardPaymentId))
    .where(
      and(
        eq(cardRepasses.status, 'pending'),
        lte(cardRepasses.expectedDate, todayYmd),
        isNull(cardPayments.reversedAt),
      ),
    )
  return rows.map((r) => r.tenantId)
}

async function lockCardPayment(tx: typeof db, tenantId: string, cardPaymentId: string) {
  const [payment] = await tx
    .select()
    .from(cardPayments)
    .where(and(eq(cardPayments.id, cardPaymentId), eq(cardPayments.tenantId, tenantId)))
    .for('update')
  if (!payment) throw new BusinessError('CARD_PAYMENT_NOT_FOUND', 'Pagamento no cartão não encontrado')
  return payment
}

export async function cancelCardPaymentTx(
  tx: typeof db,
  tenantId: string,
  userId: string,
  cardPaymentId: string,
): Promise<{ cancelledRepasses: number; receivedRepasses: number }> {
  const payment = await lockCardPayment(tx, tenantId, cardPaymentId)

  const repasses = await tx
    .select({ id: cardRepasses.id, status: cardRepasses.status })
    .from(cardRepasses)
    .where(and(eq(cardRepasses.cardPaymentId, cardPaymentId), eq(cardRepasses.tenantId, tenantId)))
    .orderBy(asc(cardRepasses.sequence))
    .for('update')

  const receivedRepasses = repasses.filter((r) => r.status === 'received').length
  if (payment.reversedAt) return { cancelledRepasses: 0, receivedRepasses }

  const cancelledRepasses = repasses.filter((r) => r.status === 'pending').length

  await tx
    .update(cardPayments)
    .set({ reversedAt: new Date(), reversedBy: userId })
    .where(and(eq(cardPayments.id, cardPaymentId), eq(cardPayments.tenantId, tenantId)))

  await tx
    .update(cardRepasses)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(cardRepasses.cardPaymentId, cardPaymentId),
        eq(cardRepasses.tenantId, tenantId),
        eq(cardRepasses.status, 'pending'),
      ),
    )

  return { cancelledRepasses, receivedRepasses }
}

export async function adjustCardRepasse(
  tenantId: string,
  userId: string,
  repasseId: string,
  data: { netAmount: number; expectedDate: string },
): Promise<void> {
  await withTransaction(async (tx) => {
    const [ref] = await tx
      .select({ cardPaymentId: cardRepasses.cardPaymentId })
      .from(cardRepasses)
      .where(and(eq(cardRepasses.id, repasseId), eq(cardRepasses.tenantId, tenantId)))
      .limit(1)
    if (!ref) throw new BusinessError('REPASSE_NOT_FOUND', 'Repasse não encontrado')

    const payment = await lockCardPayment(tx, tenantId, ref.cardPaymentId)
    const [repasse] = await tx
      .select()
      .from(cardRepasses)
      .where(and(eq(cardRepasses.id, repasseId), eq(cardRepasses.tenantId, tenantId)))
      .for('update')

    const grossCents = toCents(repasse.grossAmount)
    const netCents = toCents(data.netAmount)
    if (netCents <= 0 || netCents > grossCents) {
      throw new BusinessError(
        'INVALID_REPASSE_AMOUNT',
        'O valor líquido deve ser maior que zero e no máximo o valor bruto',
      )
    }
    if (payment.reversedAt || repasse.status === 'cancelled') {
      throw new BusinessError('REPASSE_CANCELLED', 'Repasse cancelado não pode ser ajustado')
    }

    if (netCents === toCents(repasse.netAmount) && data.expectedDate === repasse.expectedDate) return

    const todayYmd = brToday()
    const adjusted = {
      netAmount: centsToDecimal(netCents),
      feeAmount: centsToDecimal(grossCents - netCents),
      expectedDate: data.expectedDate,
      updatedAt: new Date(),
    }

    if (repasse.status === 'pending') {
      await tx
        .update(cardRepasses)
        .set(adjusted)
        .where(and(eq(cardRepasses.id, repasseId), eq(cardRepasses.tenantId, tenantId)))
      if (data.expectedDate <= todayYmd) {
        await postDueRepassesTx(tx, tenantId, { todayYmd, cardPaymentId: payment.id })
      }
    } else {
      if (data.expectedDate > todayYmd) {
        throw new BusinessError('REPASSE_DATE_IN_FUTURE', 'Repasse já recebido não pode ter data futura')
      }

      const [original] = await tx
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.id, repasse.cashMovementId!), eq(cashMovements.tenantId, tenantId)))
        .for('update')

      const [counter] = await tx
        .insert(cashMovements)
        .values({
          tenantId,
          type: 'outflow',
          amount: original.amount,
          description: repasseLedgerDescription('Ajuste de repasse: ', original.description),
          paymentMethod: original.paymentMethod,
          movementDate: original.movementDate,
          patientId: original.patientId,
          recordedBy: userId,
          cardRepasseId: repasseId,
        })
        .returning({ id: cashMovements.id })

      await tx
        .update(cashMovements)
        .set({ reversedByMovementId: counter.id })
        .where(and(eq(cashMovements.id, original.id), eq(cashMovements.tenantId, tenantId)))

      const [replacement] = await tx
        .insert(cashMovements)
        .values({
          tenantId,
          type: 'inflow',
          amount: adjusted.netAmount,
          description: original.description,
          paymentMethod: original.paymentMethod,
          movementDate: parseBrDate(data.expectedDate, '12:00:00'),
          patientId: original.patientId,
          recordedBy: userId,
          cardRepasseId: repasseId,
        })
        .returning({ id: cashMovements.id })

      await tx
        .update(cardRepasses)
        .set({ ...adjusted, cashMovementId: replacement.id })
        .where(and(eq(cardRepasses.id, repasseId), eq(cardRepasses.tenantId, tenantId)))
    }

    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'card_repasse',
        entityId: repasseId,
        changes: {
          netAmount: { old: repasse.netAmount, new: adjusted.netAmount },
          expectedDate: { old: repasse.expectedDate, new: adjusted.expectedDate },
        },
      },
      tx,
    )
  })
}

export async function listCardRepasses(
  tenantId: string,
  filters: {
    dateFrom: string
    dateTo: string
    terminalId?: string
    status?: 'pending' | 'received' | 'cancelled'
    page: number
    limit: number
  },
): Promise<{ rows: CardRepasseListRow[]; total: number; pendingNetTotal: number }> {
  const scope = [
    eq(cardRepasses.tenantId, tenantId),
    gte(cardRepasses.expectedDate, filters.dateFrom),
    lte(cardRepasses.expectedDate, filters.dateTo),
  ]
  const pendingScope = [
    eq(cardRepasses.tenantId, tenantId),
    eq(cardRepasses.status, 'pending'),
    isNull(cardPayments.reversedAt),
  ]
  if (filters.terminalId) {
    scope.push(eq(cardPayments.cardTerminalId, filters.terminalId))
    pendingScope.push(eq(cardPayments.cardTerminalId, filters.terminalId))
  }
  const conditions = filters.status ? [...scope, eq(cardRepasses.status, filters.status)] : scope
  const joinPayment = and(eq(cardPayments.id, cardRepasses.cardPaymentId), eq(cardPayments.tenantId, tenantId))

  const [rows, [totals], [pending]] = await Promise.all([
    db
      .select({
        id: cardRepasses.id,
        cardPaymentId: cardRepasses.cardPaymentId,
        sequence: cardRepasses.sequence,
        expectedDate: cardRepasses.expectedDate,
        terminalName: cardTerminals.name,
        patientId: cardPayments.patientId,
        patientName: patients.fullName,
        method: cardPayments.method,
        grossAmount: cardRepasses.grossAmount,
        feeAmount: cardRepasses.feeAmount,
        netAmount: cardRepasses.netAmount,
        status: cardRepasses.status,
        receivedAt: cardRepasses.receivedAt,
        cardPaymentReversed: sql<boolean>`${cardPayments.reversedAt} IS NOT NULL`,
      })
      .from(cardRepasses)
      .innerJoin(cardPayments, joinPayment)
      .innerJoin(
        cardTerminals,
        and(eq(cardTerminals.id, cardPayments.cardTerminalId), eq(cardTerminals.tenantId, tenantId)),
      )
      .innerJoin(patients, and(eq(patients.id, cardPayments.patientId), eq(patients.tenantId, tenantId)))
      .where(and(...conditions))
      .orderBy(asc(cardRepasses.expectedDate), asc(cardRepasses.id))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit),
    db
      .select({ total: count() })
      .from(cardRepasses)
      .innerJoin(cardPayments, joinPayment)
      .where(and(...conditions)),
    db
      .select({ total: sum(cardRepasses.netAmount) })
      .from(cardRepasses)
      .innerJoin(cardPayments, joinPayment)
      .where(and(...pendingScope)),
  ])

  return {
    rows,
    total: Number(totals?.total ?? 0),
    pendingNetTotal: Number(pending?.total ?? 0),
  }
}

export async function getCardPaymentSummaries(
  tx: typeof db,
  tenantId: string,
  cardPaymentIds: string[],
): Promise<Map<string, CardPaymentSummary>> {
  const summaries = new Map<string, CardPaymentSummary>()
  if (cardPaymentIds.length === 0) return summaries

  const payments = await tx
    .select({
      id: cardPayments.id,
      method: cardPayments.method,
      installmentCount: cardPayments.installmentCount,
      terminalName: cardTerminals.name,
    })
    .from(cardPayments)
    .innerJoin(
      cardTerminals,
      and(eq(cardTerminals.id, cardPayments.cardTerminalId), eq(cardTerminals.tenantId, tenantId)),
    )
    .where(and(eq(cardPayments.tenantId, tenantId), inArray(cardPayments.id, cardPaymentIds)))

  const repasseCounts = await tx
    .select({ cardPaymentId: cardRepasses.cardPaymentId, status: cardRepasses.status, total: count() })
    .from(cardRepasses)
    .where(and(eq(cardRepasses.tenantId, tenantId), inArray(cardRepasses.cardPaymentId, cardPaymentIds)))
    .groupBy(cardRepasses.cardPaymentId, cardRepasses.status)

  const linked = await tx
    .select({ cardPaymentId: paymentRecords.cardPaymentId, total: count() })
    .from(paymentRecords)
    .innerJoin(cardPayments, eq(cardPayments.id, paymentRecords.cardPaymentId))
    .where(
      and(
        eq(cardPayments.tenantId, tenantId),
        inArray(paymentRecords.cardPaymentId, cardPaymentIds),
        isNull(paymentRecords.reversedAt),
      ),
    )
    .groupBy(paymentRecords.cardPaymentId)

  for (const p of payments) {
    const countOf = (status: string) =>
      Number(repasseCounts.find((r) => r.cardPaymentId === p.id && r.status === status)?.total ?? 0)
    summaries.set(p.id, {
      terminalName: p.terminalName,
      method: p.method,
      installmentCount: p.installmentCount,
      pendingRepasses: countOf('pending'),
      receivedRepasses: countOf('received'),
      linkedPaymentCount: Number(linked.find((l) => l.cardPaymentId === p.id)?.total ?? 0),
    })
  }
  return summaries
}

export async function sumCardFeesForPeriod(tenantId: string, rangeStart: Date, rangeEnd: Date): Promise<number> {
  const [row] = await db
    .select({ total: sum(cardRepasses.feeAmount) })
    .from(cardRepasses)
    .innerJoin(
      cardPayments,
      and(eq(cardPayments.id, cardRepasses.cardPaymentId), eq(cardPayments.tenantId, tenantId)),
    )
    .where(
      and(
        eq(cardRepasses.tenantId, tenantId),
        ne(cardRepasses.status, 'cancelled'),
        gte(cardPayments.paidAt, rangeStart),
        lte(cardPayments.paidAt, rangeEnd),
      ),
    )
  return Number(row?.total ?? 0)
}
