// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  auditLogs,
  bankReconciliationAllocations,
  cashMovements,
  expenseCategories,
  expenseInstallments,
  expenses,
  financialEntries,
  installments,
  patients,
  paymentRecords,
  tenants,
  users,
} from '@/db/schema'
import { parseOfx } from '@/lib/financial/ofx'
import {
  createFinancialAccount,
  createTransfer,
  listFinancialAccounts,
  moveMovementsToAccount,
  paymentInflowAccountId,
  previewMoveMovements,
  resolveMovementAccountId,
  reversalAccountId,
  setFinancialAccountArchived,
  type FinancialAccountRow,
} from '../financial-accounts'
import { exportLedgerCSV, getLedgerSummary, listCashMovements } from '../cash-movements'
import { allocateStatementLine, commitStatementImport, listStatementLines } from '../bank-reconciliation'
import { payExpenseInstallment, revertExpenseInstallmentPayment } from '../expenses'

/**
 * The audit insert is the last write of a move and of a reversal. `fail` makes
 * it fail (rollback test); `pause` holds the next one of an entity type until
 * released, keeping that transaction open with every lock it took (races).
 */
const audit = vi.hoisted(() => ({
  fail: false,
  pause: null as null | { entityType: string; reached: () => void; gate: Promise<void> },
}))
vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>()
  return {
    ...actual,
    createAuditLog: async (...args: Parameters<typeof actual.createAuditLog>) => {
      if (audit.fail) throw new Error('audit down')
      const pause = audit.pause
      if (pause && args[0].entityType === pause.entityType) {
        audit.pause = null
        pause.reached()
        await pause.gate
      }
      return actual.createAuditLog(...args)
    },
  }
})

/** Pauses the next audited write of `entityType` just before it commits. */
function pauseBeforeCommit(entityType: string) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let reached!: () => void
  const paused = new Promise<void>((resolve) => (reached = resolve))
  audit.pause = { entityType, reached, gate }
  return { paused, release }
}

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const CLINIC = '00000000-0000-0000-0000-0000000fa001'
const OTHER_CLINIC = '00000000-0000-0000-0000-0000000fa002'
const NEW_CLINIC = '00000000-0000-0000-0000-0000000fa003'
const USER = '00000000-0000-0000-0000-0000000fa004'
const MOVE_CLINIC = '00000000-0000-0000-0000-0000000fa005'
const PATIENT = '00000000-0000-0000-0000-0000000fa006'
const ENTRY = '00000000-0000-0000-0000-0000000fa007'
const INSTALLMENT = '00000000-0000-0000-0000-0000000fa008'
const CATEGORY = '00000000-0000-0000-0000-0000000fa009'

const PERIOD = { dateFrom: '2026-10-01', dateTo: '2026-11-30', type: 'all' as const }

const account = (kind: 'bank' | 'cash', name: string, opening = 0, openingDate: string | null = null) => ({
  kind,
  name,
  bankName: null,
  bankAgency: null,
  bankAccount: null,
  isDefault: true,
  openingBalance: opening,
  openingBalanceDate: openingDate,
})

function inflow(tenantId: string, accountId: string, amount: string, movementDate: Date) {
  return { tenantId, accountId, type: 'inflow', amount, description: 'Pagamento', movementDate, recordedBy: USER }
}

async function balanceOf(tenantId: string, accountId: string) {
  const rows = await listFinancialAccounts(tenantId, { includeArchived: true })
  return rows.find((r) => r.id === accountId)?.balance
}

async function transferLegCount(tenantId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(cashMovements)
    .where(and(eq(cashMovements.tenantId, tenantId), isNotNull(cashMovements.transferGroupId)))
  return Number(row.n)
}

describeIntegration('financial accounts (integration, requires test DB)', () => {
  let cash: FinancialAccountRow
  let bank: FinancialAccountRow
  let otherBank: FinancialAccountRow

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: CLINIC, name: 'Contas', slug: 'financial-accounts-test' },
      { id: OTHER_CLINIC, name: 'Outra', slug: 'financial-accounts-test-other' },
      { id: NEW_CLINIC, name: 'Nova', slug: 'financial-accounts-test-new' },
    ])
    await db.insert(users).values({ id: USER, email: 'contas@test.local', fullName: 'Dra.' })
    cash = await createFinancialAccount(CLINIC, USER, account('cash', 'Caixa'))
    bank = await createFinancialAccount(CLINIC, USER, account('bank', 'Itaú', 1000, '2026-11-01'))
    otherBank = await createFinancialAccount(OTHER_CLINIC, USER, account('bank', 'Outro banco'))
  })

  it("sends cash to the clinic's drawer and every other method to its bank", async () => {
    expect(await resolveMovementAccountId(db, CLINIC, { method: 'cash' })).toBe(cash.id)
    expect(await resolveMovementAccountId(db, CLINIC, { method: 'pix' })).toBe(bank.id)
    expect(await resolveMovementAccountId(db, CLINIC, { method: 'transfer' })).toBe(bank.id)
  })

  it("refuses another clinic's account, whether picked, referenced or transferred to", async () => {
    await expect(resolveMovementAccountId(db, CLINIC, { accountId: otherBank.id })).rejects.toMatchObject({
      code: 'FINANCIAL_ACCOUNT_NOT_FOUND',
    })
    // The (tenant_id, account_id) foreign key holds even for a writer that skips the check.
    await expect(
      db.insert(cashMovements).values(inflow(CLINIC, otherBank.id, '10.00', new Date('2026-11-02T15:00:00Z'))),
    ).rejects.toThrow()
    await expect(
      createTransfer(CLINIC, USER, { fromAccountId: bank.id, toAccountId: otherBank.id, amount: 10, date: '2026-11-02' }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_ACCOUNT_NOT_FOUND' })
  })

  it('counts movements from the start of the opening BR day, not the UTC one', async () => {
    await db.insert(cashMovements).values([
      // 23:00 on Oct 31 in BR, already inside the opening balance.
      inflow(CLINIC, bank.id, '50.00', new Date('2026-11-01T02:00:00Z')),
      // 00:00 on Nov 1 in BR, the first instant after it.
      inflow(CLINIC, bank.id, '30.00', new Date('2026-11-01T03:00:00Z')),
    ])

    expect(await balanceOf(CLINIC, bank.id)).toBe(1030)
  })

  it('moves money between accounts without counting it as revenue or expense', async () => {
    const { transferGroupId } = await createTransfer(CLINIC, USER, {
      fromAccountId: bank.id,
      toAccountId: cash.id,
      amount: 200,
      date: '2026-11-02',
    })

    const legs = await db.select().from(cashMovements).where(eq(cashMovements.transferGroupId, transferGroupId))
    expect(legs.map((l) => [l.type, l.accountId, l.amount]).sort()).toEqual([
      ['inflow', cash.id, '200.00'],
      ['outflow', bank.id, '200.00'],
    ])
    expect(await balanceOf(CLINIC, bank.id)).toBe(830)
    expect(await balanceOf(CLINIC, cash.id)).toBe(200)

    const summary = await getLedgerSummary(CLINIC, { ...PERIOD, page: 1, limit: 50 })
    expect(Number(summary.totalInflows)).toBe(80)
    expect(Number(summary.totalOutflows)).toBe(0)
    expect(Number(summary.netResult)).toBe(80)
    expect(Number(summary.transfersIn)).toBe(200)
    expect(Number(summary.transfersOut)).toBe(200)
  })

  it('writes neither leg of a transfer that fails', async () => {
    const before = await transferLegCount(CLINIC)

    // Past numeric(10,2): the one insert carrying both legs fails as a whole.
    await expect(
      createTransfer(CLINIC, USER, { fromAccountId: bank.id, toAccountId: cash.id, amount: 100_000_000, date: '2026-11-02' }),
    ).rejects.toThrow()

    expect(await transferLegCount(CLINIC)).toBe(before)
  })

  it('filters the ledger and its export by account', async () => {
    const page = await listCashMovements(CLINIC, { ...PERIOD, accountId: cash.id, page: 1, limit: 50 })
    expect(page.data.length).toBeGreaterThan(0)
    expect(page.data.every((m) => m.accountId === cash.id && m.accountName === 'Caixa')).toBe(true)

    // Asked for the account balance (Owner, Financeiro): the newest row's running balance is the account's balance.
    const bankPage = await listCashMovements(
      CLINIC,
      { ...PERIOD, accountId: bank.id, page: 1, limit: 50 },
      { accountBalance: true },
    )
    expect(Number(bankPage.data[0].runningBalance)).toBe(await balanceOf(CLINIC, bank.id))
    // Not asked (receptionist): only the sum of the rows shown, no opening balance.
    const plainPage = await listCashMovements(CLINIC, { ...PERIOD, accountId: bank.id, page: 1, limit: 50 })
    expect(Number(plainPage.data[0].runningBalance)).toBe(50 + 30 - 200)
    // 23:00 on Oct 31 in BR is before the opening day: the balance there is not the opening one.
    const beforeOpening = bankPage.data.find((m) => m.movementDate.toISOString() === '2026-11-01T02:00:00.000Z')
    expect(Number(beforeOpening?.runningBalance)).toBe(0)

    const [header, ...lines] = (await exportLedgerCSV(CLINIC, { ...PERIOD, accountId: cash.id })).split('\n')
    expect(header).toBe('Data,Tipo,Descricao,Paciente/Categoria,Metodo,Valor,Conta')
    expect(lines.length).toBe(page.data.length)
    expect(lines.every((line) => line.endsWith(',"Caixa"'))).toBe(true)
  })

  it('keeps an archived account on its history and reversals but stops offering it', async () => {
    await setFinancialAccountArchived(CLINIC, USER, bank.id, true)

    await expect(resolveMovementAccountId(db, CLINIC, { accountId: bank.id })).rejects.toMatchObject({
      code: 'FINANCIAL_ACCOUNT_NOT_FOUND',
    })
    expect(await resolveMovementAccountId(db, CLINIC, { method: 'pix' })).not.toBe(bank.id)
    expect(await reversalAccountId(db, CLINIC, bank.id)).toBe(bank.id)
    expect((await listFinancialAccounts(CLINIC)).map((a) => a.id)).not.toContain(bank.id)
    expect(await balanceOf(CLINIC, bank.id)).toBe(830)
  })

  it('provisions a new clinic one Caixa and one Banco on its first movements', async () => {
    const drawer = await resolveMovementAccountId(db, NEW_CLINIC, { method: 'cash' })
    expect(await resolveMovementAccountId(db, NEW_CLINIC, { method: 'cash' })).toBe(drawer)
    const main = await resolveMovementAccountId(db, NEW_CLINIC, { method: 'pix' })

    const accounts = await listFinancialAccounts(NEW_CLINIC)
    expect(accounts.map((a) => [a.id, a.kind, a.name, a.isDefault]).sort()).toEqual(
      [
        [drawer, 'cash', 'Caixa', true],
        [main, 'bank', 'Banco', true],
      ].sort(),
    )
  })

})

describeIntegration('moving movements between accounts (integration, requires test DB)', () => {
  // A clinic of its own: the suite above archives its bank, which can't be a destination.
  let drawer: FinancialAccountRow
  let itau: FinancialAccountRow
  let legacyId: string
  let lineSeq = 0

  const day = new Date('2026-11-03T15:00:00Z')

  async function movement(accountId: string, amount: string, extra: Partial<typeof cashMovements.$inferInsert> = {}) {
    const [row] = await db
      .insert(cashMovements)
      .values({ ...inflow(MOVE_CLINIC, accountId, amount, day), ...extra })
      .returning()
    return row
  }

  /** An original and its reversal counter, linked the way reversePayment links them. */
  async function reversedPair(accountId: string, amount: string) {
    const original = await movement(accountId, amount)
    const counter = await movement(accountId, amount, { type: 'outflow' })
    await db.update(cashMovements).set({ reversedByMovementId: counter.id }).where(eq(cashMovements.id, original.id))
    return { original, counter }
  }

  /** One credit line on Itaú's statement, for matching. */
  async function statementLine(amount: string) {
    lineSeq += 1
    const memo = `Credito ${lineSeq}`
    await commitStatementImport(MOVE_CLINIC, USER, {
      accountId: itau.id,
      fileName: `extrato-${lineSeq}.ofx`,
      parsed: parseOfx(
        `OFXHEADER:100\n\n<OFX><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>1<ACCTID>9</BANKACCTFROM><BANKTRANLIST>` +
          `<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261103000000[-3:BRT]<TRNAMT>${amount}<FITID>mv-${lineSeq}<MEMO>${memo}</STMTTRN>` +
          `</BANKTRANLIST></STMTRS></OFX>`,
      ),
    })
    const { lines } = await listStatementLines(MOVE_CLINIC, { accountId: itau.id, status: 'all', limit: 200 })
    return lines.find((l) => l.memo === memo)!
  }

  async function accountsOf(ids: string[]) {
    const rows = await db.select().from(cashMovements).where(inArray(cashMovements.id, ids))
    return Object.fromEntries(rows.map((r) => [r.id, r.accountId]))
  }

  /**
   * Runs `work` in a transaction and keeps it open, holding its locks, until
   * release() is called: the other half of a race, paused at the worst moment.
   */
  async function holdTransaction(work: (tx: typeof db) => Promise<void>) {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let ready!: () => void
    const started = new Promise<void>((resolve) => (ready = resolve))
    const done = db.transaction(async (tx) => {
      await work(tx as unknown as typeof db)
      ready()
      await gate
    })
    await Promise.race([started, done])
    return { release, done }
  }

  /** A paid expense installment: its outflow left the drawer through payExpenseInstallment. */
  async function paidExpense(amount: string) {
    const [expense] = await db
      .insert(expenses)
      .values({ tenantId: MOVE_CLINIC, categoryId: CATEGORY, description: 'Aluguel', totalAmount: amount, createdBy: USER })
      .returning()
    const [installment] = await db
      .insert(expenseInstallments)
      .values({ expenseId: expense.id, installmentNumber: 1, amount, dueDate: '2026-11-03' })
      .returning()
    await payExpenseInstallment(MOVE_CLINIC, installment.id, 'cash', USER, day.toISOString(), drawer.id)
    const [outflow] = await db.select().from(cashMovements).where(eq(cashMovements.expenseInstallmentId, installment.id))
    return { installmentId: installment.id, outflowId: outflow.id }
  }

  async function expenseCounterId(installmentId: string) {
    const [counter] = await db
      .select({ id: cashMovements.id })
      .from(cashMovements)
      .where(and(eq(cashMovements.expenseInstallmentId, installmentId), eq(cashMovements.type, 'inflow')))
    return counter.id
  }

  /**
   * Resolves once some session is blocked on a lock, i.e. the racing call
   * reached the held rows. With `event`, only a wait on that kind of lock
   * ('advisory', 'transactionid'...) counts.
   */
  async function waitForLockWait(event?: string) {
    for (let i = 0; i < 200; i++) {
      const rows = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND datname = current_database()
              AND (${event ?? null}::text IS NULL OR wait_event = ${event ?? null}::text)`,
      )
      if (Number(rows[0]?.n) > 0) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('nothing ever waited on the held lock')
  }

  beforeAll(async () => {
    await db.insert(tenants).values({ id: MOVE_CLINIC, name: 'Mover', slug: 'financial-accounts-move-test' })
    drawer = await createFinancialAccount(MOVE_CLINIC, USER, account('cash', 'Caixa'))
    itau = await createFinancialAccount(MOVE_CLINIC, USER, account('bank', 'Itaú'))
    // The account 0050 gives a clinic's pre-account history.
    legacyId = await reversalAccountId(db, MOVE_CLINIC, null)

    await db.insert(patients).values({ id: PATIENT, tenantId: MOVE_CLINIC, fullName: 'Ana', phone: '11999990000' })
    await db.insert(financialEntries).values({
      id: ENTRY,
      tenantId: MOVE_CLINIC,
      patientId: PATIENT,
      description: 'Botox',
      totalAmount: '90.00',
      createdBy: USER,
    })
    await db.insert(installments).values({
      id: INSTALLMENT,
      tenantId: MOVE_CLINIC,
      financialEntryId: ENTRY,
      installmentNumber: 1,
      amount: '90.00',
      dueDate: '2026-11-03',
      appliedFineType: 'percentage',
      appliedFineValue: '0',
      appliedInterestRate: '0',
      appliedGracePeriodDays: 0,
    })
    await db.insert(expenseCategories).values({ id: CATEGORY, tenantId: MOVE_CLINIC, name: 'Aluguel' })
  })

  it('moves a payment and its reversal together, leaving amount and date alone, and audits each old account', async () => {
    const { original, counter } = await reversedPair(drawer.id, '70.00')

    // Picking only the counter still moves the pair.
    const result = await moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: itau.id, movementIds: [counter.id] })
    expect(result).toEqual({ moved: 1, skippedReconciled: 0, skippedTransfers: 0 })

    const rows = await db.select().from(cashMovements).where(inArray(cashMovements.id, [original.id, counter.id]))
    expect(rows.map((r) => [r.accountId, r.amount, r.movementDate.toISOString()])).toEqual([
      [itau.id, '70.00', day.toISOString()],
      [itau.id, '70.00', day.toISOString()],
    ])

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, MOVE_CLINIC), eq(auditLogs.entityType, 'cash_movement_account')))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1)
    expect(log.changes).toEqual({
      accountId: { old: { [original.id]: drawer.id, [counter.id]: drawer.id }, new: itau.id },
    })
  })

  it('skips a reversed payment whose counter is matched to the statement, keeping both halves', async () => {
    const { original, counter } = await reversedPair(itau.id, '30.00')
    const line = await statementLine('30.00')
    await allocateStatementLine(MOVE_CLINIC, USER, line.id, [{ movementId: original.id, amountCents: 3000 }])

    const preview = await previewMoveMovements(MOVE_CLINIC, { toAccountId: drawer.id, movementIds: [counter.id] })
    expect(preview).toEqual({ moved: 0, skippedReconciled: 1, skippedTransfers: 0, total: '0.00' })

    const result = await moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: drawer.id, movementIds: [counter.id] })
    expect(result).toEqual({ moved: 0, skippedReconciled: 1, skippedTransfers: 0 })
    expect(await accountsOf([original.id, counter.id])).toEqual({ [original.id]: itau.id, [counter.id]: itau.id })
  })

  it('lets money leave the legacy account but never land on it', async () => {
    const old = await movement(legacyId, '15.00')

    await expect(
      moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: legacyId, movementIds: [old.id] }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_ACCOUNT_NOT_FOUND' })
    expect(await accountsOf([old.id])).toEqual({ [old.id]: legacyId })

    await moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: drawer.id, movementIds: [old.id] })
    expect(await accountsOf([old.id])).toEqual({ [old.id]: drawer.id })
  })

  it('skips transfer legs and refuses another clinic or an unknown movement', async () => {
    const { transferGroupId } = await createTransfer(MOVE_CLINIC, USER, {
      fromAccountId: drawer.id,
      toAccountId: itau.id,
      amount: 5,
      date: '2026-11-03',
    })
    const legs = await db
      .select({ id: cashMovements.id })
      .from(cashMovements)
      .where(eq(cashMovements.transferGroupId, transferGroupId))
    const result = await moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: drawer.id, movementIds: legs.map((l) => l.id) })
    expect(result).toEqual({ moved: 0, skippedReconciled: 0, skippedTransfers: 2 })

    const otherClinics = await createFinancialAccount(OTHER_CLINIC, USER, account('cash', 'Caixa'))
    await expect(
      moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: otherClinics.id, movementIds: legs.map((l) => l.id) }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_ACCOUNT_NOT_FOUND' })
    await expect(
      moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: itau.id, movementIds: ['00000000-0000-0000-0000-00000000dead'] }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_ACCOUNT_NOT_FOUND' })
  })

  it('previews then moves a whole account for a period, BR days inclusive', async () => {
    const from = await createFinancialAccount(MOVE_CLINIC, USER, { ...account('cash', 'Caixa 2'), isDefault: false })
    // 23:30 on Nov 30 in BR is still inside the period; 23:30 on Oct 31 is not.
    const inside = await movement(from.id, '10.00', { movementDate: new Date('2026-12-01T02:30:00Z') })
    const refund = await movement(from.id, '4.00', { type: 'outflow', movementDate: new Date('2026-11-10T15:00:00Z') })
    const outside = await movement(from.id, '11.00', { movementDate: new Date('2026-11-01T02:30:00Z') })
    const period = { toAccountId: itau.id, fromAccountId: from.id, dateFrom: '2026-11-01', dateTo: '2026-11-30' }

    expect(await previewMoveMovements(MOVE_CLINIC, period)).toEqual({
      moved: 2,
      skippedReconciled: 0,
      skippedTransfers: 0,
      total: '6.00',
    })
    // The preview writes nothing.
    expect(await accountsOf([inside.id])).toEqual({ [inside.id]: from.id })

    expect(await moveMovementsToAccount(MOVE_CLINIC, USER, period)).toEqual({ moved: 2, skippedReconciled: 0, skippedTransfers: 0 })
    expect(await accountsOf([inside.id, refund.id, outside.id])).toEqual({
      [inside.id]: itau.id,
      [refund.id]: itau.id,
      [outside.id]: from.id,
    })
  })

  it('rolls the whole move back when its audit entry fails', async () => {
    const a = await movement(drawer.id, '8.00')
    const b = await movement(drawer.id, '9.00')
    const before = await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.tenantId, MOVE_CLINIC))

    audit.fail = true
    try {
      await expect(
        moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: itau.id, movementIds: [a.id, b.id] }),
      ).rejects.toThrow('audit down')
    } finally {
      audit.fail = false
    }

    expect(await accountsOf([a.id, b.id])).toEqual({ [a.id]: drawer.id, [b.id]: drawer.id })
    const after = await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.tenantId, MOVE_CLINIC))
    expect(after[0].n).toBe(before[0].n)
  })

  describe('racing other writers', () => {
    it('skips a movement whose match commits while the move waits, so the match never points at another account', async () => {
      const paid = await movement(itau.id, '40.00')
      const line = await statementLine('40.00')

      // A reconciliation holding the movement, its allocation written but not committed.
      const match = await holdTransaction(async (tx) => {
        await tx.select({ id: cashMovements.id }).from(cashMovements).where(eq(cashMovements.id, paid.id)).for('update')
        await tx.insert(bankReconciliationAllocations).values({
          tenantId: MOVE_CLINIC,
          accountId: itau.id,
          lineId: line.id,
          movementId: paid.id,
          amountCents: 4000,
          createdBy: USER,
        })
      })
      const move = moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: drawer.id, movementIds: [paid.id] })
      await waitForLockWait()
      match.release()
      await match.done

      expect(await move).toEqual({ moved: 0, skippedReconciled: 1, skippedTransfers: 0 })
      expect(await accountsOf([paid.id])).toEqual({ [paid.id]: itau.id })
    })

    it('refuses a match on a movement a move has already taken to another account', async () => {
      const paid = await movement(itau.id, '41.00')
      const line = await statementLine('41.00')

      // A move holding the movement, re-pointed at the drawer but not committed.
      const moving = await holdTransaction(async (tx) => {
        await tx.select({ id: cashMovements.id }).from(cashMovements).where(eq(cashMovements.id, paid.id)).for('update')
        await tx.update(cashMovements).set({ accountId: drawer.id }).where(eq(cashMovements.id, paid.id))
      })
      const match = allocateStatementLine(MOVE_CLINIC, USER, line.id, [{ movementId: paid.id, amountCents: 4100 }])
      await waitForLockWait()
      moving.release()
      await moving.done

      await expect(match).rejects.toMatchObject({ code: 'ALLOCATION_ACCOUNT' })
    })

    it('moves the counter of a reversal that commits while the move waits', async () => {
      const original = await movement(drawer.id, '50.00')
      let counterId = ''

      // A reversal holding the original, its counter written on the old account but not committed.
      const reversal = await holdTransaction(async (tx) => {
        await tx.select({ id: cashMovements.id }).from(cashMovements).where(eq(cashMovements.id, original.id)).for('update')
        const [counter] = await tx
          .insert(cashMovements)
          .values({ ...inflow(MOVE_CLINIC, drawer.id, '50.00', day), type: 'outflow' })
          .returning()
        counterId = counter.id
        await tx.update(cashMovements).set({ reversedByMovementId: counter.id }).where(eq(cashMovements.id, original.id))
      })
      const move = moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: itau.id, movementIds: [original.id] })
      await waitForLockWait()
      reversal.release()
      await reversal.done

      expect(await move).toEqual({ moved: 1, skippedReconciled: 0, skippedTransfers: 0 })
      expect(await accountsOf([original.id, counterId])).toEqual({ [original.id]: itau.id, [counterId]: itau.id })
    })

    it('writes a reversal on the account a move committed while the reversal waited', async () => {
      const [record] = await db
        .insert(paymentRecords)
        .values({ installmentId: INSTALLMENT, amount: '60.00', paymentMethod: 'pix', paidAt: day, recordedBy: USER })
        .returning()
      const original = await movement(drawer.id, '60.00', { paymentRecordId: record.id })

      // A move holding the inflow, re-pointed at Itaú but not committed.
      const moving = await holdTransaction(async (tx) => {
        await tx.select({ id: cashMovements.id }).from(cashMovements).where(eq(cashMovements.id, original.id)).for('update')
        await tx.update(cashMovements).set({ accountId: itau.id }).where(eq(cashMovements.id, original.id))
      })
      // What reversePayment asks for, inside its own transaction, before writing the counter.
      const reversalAccount = db.transaction((tx) => paymentInflowAccountId(tx as unknown as typeof db, MOVE_CLINIC, record.id))
      await waitForLockWait()
      moving.release()
      await moving.done

      expect(await reversalAccount).toBe(itau.id)
    })

    it('writes an expense reversal on the account a move committed while the reversal waited', async () => {
      const { installmentId, outflowId } = await paidExpense('25.00')

      // The move has re-pointed the outflow at Itaú and holds it, about to commit.
      const pause = pauseBeforeCommit('cash_movement_account')
      const move = moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: itau.id, movementIds: [outflowId] })
      await pause.paused
      const reversal = revertExpenseInstallmentPayment(MOVE_CLINIC, installmentId, USER)
      await waitForLockWait('transactionid')
      pause.release()

      expect(await move).toEqual({ moved: 1, skippedReconciled: 0, skippedTransfers: 0 })
      await reversal
      const counterId = await expenseCounterId(installmentId)
      expect(await accountsOf([outflowId, counterId])).toEqual({ [outflowId]: itau.id, [counterId]: itau.id })
    })

    it('moves both halves of an expense reversal that commits while the move waits', async () => {
      const { installmentId, outflowId } = await paidExpense('26.00')

      // The reversal has written its counter on the drawer and holds the outflow, about to commit.
      const pause = pauseBeforeCommit('expense_installment')
      const reversal = revertExpenseInstallmentPayment(MOVE_CLINIC, installmentId, USER)
      await pause.paused
      const move = moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: itau.id, movementIds: [outflowId] })
      await waitForLockWait('transactionid')
      pause.release()
      await reversal

      expect(await move).toEqual({ moved: 1, skippedReconciled: 0, skippedTransfers: 0 })
      const counterId = await expenseCounterId(installmentId)
      expect(await accountsOf([outflowId, counterId])).toEqual({ [outflowId]: itau.id, [counterId]: itau.id })
    })

    it('runs two moves of opposite halves of a pair one after the other, never split and never deadlocked', async () => {
      const { original, counter } = await reversedPair(drawer.id, '27.00')

      // The first move took the original (and with it the counter) and is about to commit.
      const pause = pauseBeforeCommit('cash_movement_account')
      const first = moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: itau.id, movementIds: [original.id] })
      await pause.paused
      // The second one waits for the first before locking any row.
      const second = moveMovementsToAccount(MOVE_CLINIC, USER, { toAccountId: drawer.id, movementIds: [counter.id] })
      await waitForLockWait('advisory')
      pause.release()

      expect(await first).toEqual({ moved: 1, skippedReconciled: 0, skippedTransfers: 0 })
      expect(await second).toEqual({ moved: 1, skippedReconciled: 0, skippedTransfers: 0 })
      expect(await accountsOf([original.id, counter.id])).toEqual({ [original.id]: drawer.id, [counter.id]: drawer.id })
    })
  })
})
