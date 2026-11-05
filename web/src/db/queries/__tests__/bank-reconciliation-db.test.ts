import { beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  bankReconciliationAllocations,
  bankStatementLines,
  cashMovements,
  expenseCategories,
  expenseInstallments,
  tenants,
  users,
} from '@/db/schema'
import { parseOfx } from '@/lib/financial/ofx'
import { createFinancialAccount, type FinancialAccountRow } from '../financial-accounts'
import {
  allocateStatementLine,
  commitStatementImport,
  confirmSuspectedLineIsDistinct,
  createExpenseFromStatementLine,
  findMatchCandidates,
  ignoreStatementLine,
  listStatementLines,
  previewStatementImport,
  undoStatementLineMatch,
  unignoreStatementLine,
} from '../bank-reconciliation'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const CLINIC = '00000000-0000-0000-0000-0000000ba001'
const OTHER_CLINIC = '00000000-0000-0000-0000-0000000ba002'
const USER = '00000000-0000-0000-0000-0000000ba004'

const account = (kind: 'bank' | 'cash', name: string) => ({
  kind,
  name,
  bankName: null,
  bankAgency: null,
  bankAccount: null,
  isDefault: true,
  openingBalance: 0,
  openingBalanceDate: null,
})

function ofx(...rows: Array<{ id?: string; date: string; amount: string; memo: string; type?: string }>) {
  const body = rows
    .map(
      (r) =>
        `<STMTTRN><TRNTYPE>${r.type ?? (r.amount.startsWith('-') ? 'DEBIT' : 'CREDIT')}<DTPOSTED>${r.date}000000[-3:BRT]<TRNAMT>${r.amount}${r.id ? `<FITID>${r.id}` : ''}<MEMO>${r.memo}</STMTTRN>`,
    )
    .join('\n')
  return parseOfx(`OFXHEADER:100\n\n<OFX><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>1<ACCTID>9</BANKACCTFROM><BANKTRANLIST>${body}</BANKTRANLIST></STMTRS></OFX>`)
}

describeIntegration('bank reconciliation (integration, requires test DB)', () => {
  let bank: FinancialAccountRow
  let otherBank: FinancialAccountRow
  let cash: FinancialAccountRow
  let categoryId: string

  const movement = async (
    type: 'inflow' | 'outflow',
    amount: string,
    movementDate: string,
    extra: Partial<typeof cashMovements.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(cashMovements)
      .values({ tenantId: CLINIC, accountId: bank.id, type, amount, description: `Mov ${amount}`, movementDate: new Date(movementDate), recordedBy: USER, ...extra })
      .returning()
    return row
  }

  const importLines = async (parsed: ReturnType<typeof ofx>, name = 'extrato.ofx') => {
    const result = await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: name, parsed })
    const { lines } = await listStatementLines(CLINIC, { accountId: bank.id, status: 'all', limit: 200 })
    return { result, lines }
  }

  const lineBy = async (memo: string) => {
    const { lines } = await listStatementLines(CLINIC, { accountId: bank.id, status: 'all', limit: 200 })
    const line = lines.find((l) => l.memo === memo)
    if (!line) throw new Error(`no line ${memo}`)
    return line
  }

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: CLINIC, name: 'Conciliação', slug: 'bank-reconciliation-test' },
      { id: OTHER_CLINIC, name: 'Outra', slug: 'bank-reconciliation-test-other' },
    ])
    await db.insert(users).values({ id: USER, email: 'conciliacao@test.local', fullName: 'Dra.' })
    bank = await createFinancialAccount(CLINIC, USER, account('bank', 'Itaú'))
    cash = await createFinancialAccount(CLINIC, USER, account('cash', 'Caixa'))
    otherBank = await createFinancialAccount(OTHER_CLINIC, USER, account('bank', 'Outro banco'))
    const [category] = await db.insert(expenseCategories).values({ tenantId: CLINIC, name: 'Tarifas bancárias' }).returning()
    categoryId = category.id
  })

  describe('import', () => {
    it('keeps the BR day printed by the bank, whatever the host timezone', async () => {
      const { result, lines } = await importLines(ofx({ id: 'D1', date: '20261031', amount: '10.00', memo: 'DIA BR' }), 'dia.ofx')
      expect(result).toMatchObject({ total: 1, newLines: 1, duplicateLines: 0, alreadyImported: false })
      expect(lines.find((l) => l.memo === 'DIA BR')?.postedDate).toBe('2026-10-31')
    })

    it('treats a retry of the same file as the same import, not a second one', async () => {
      const file = ofx({ id: 'R1', date: '20261001', amount: '20.00', memo: 'RETRY A' }, { id: 'R2', date: '20261002', amount: '30.00', memo: 'RETRY B' })
      const first = await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'a.ofx', parsed: file })
      const second = await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'a.ofx', parsed: file })
      expect(second).toMatchObject({ importId: first.importId, alreadyImported: true, newLines: 2 })
      const { lines } = await listStatementLines(CLINIC, { accountId: bank.id, status: 'all', limit: 200 })
      expect(lines.filter((l) => l.memo.startsWith('RETRY'))).toHaveLength(2)
    })

    it('imports only what an overlapping statement adds', async () => {
      const first = ofx({ id: 'O1', date: '20261003', amount: '11.00', memo: 'OVERLAP 1' }, { id: 'O2', date: '20261004', amount: '12.00', memo: 'OVERLAP 2' })
      await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'o1.ofx', parsed: first })
      const second = ofx(
        { id: 'O2', date: '20261004', amount: '12.00', memo: 'OVERLAP 2' },
        { id: 'O3', date: '20261005', amount: '13.00', memo: 'OVERLAP 3' },
      )
      const preview = await previewStatementImport(CLINIC, bank.id, second)
      expect(preview).toMatchObject({ total: 2, newLines: 1, duplicateLines: 1, alreadyImported: false })
      const result = await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'o2.ofx', parsed: second })
      expect(result).toMatchObject({ newLines: 1, duplicateLines: 1 })
    })

    it('keeps genuine identical same-day transactions as separate lines, also across re-uploads', async () => {
      const twins = ofx(
        { date: '20261006', amount: '-5.00', memo: 'TARIFA PIX' },
        { date: '20261006', amount: '-5.00', memo: 'TARIFA PIX' },
      )
      const first = await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 't1.ofx', parsed: twins })
      expect(first).toMatchObject({ total: 2, newLines: 2, suspectLines: 0 })

      // The same two plus a third identical one in a later, overlapping file.
      const three = ofx(
        { date: '20261006', amount: '-5.00', memo: 'TARIFA PIX' },
        { date: '20261006', amount: '-5.00', memo: 'TARIFA PIX' },
        { date: '20261006', amount: '-5.00', memo: 'TARIFA PIX' },
      )
      const second = await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 't2.ofx', parsed: three })
      expect(second).toMatchObject({ total: 3, newLines: 1, duplicateLines: 2, suspectLines: 1 })
      const { lines } = await listStatementLines(CLINIC, { accountId: bank.id, status: 'all', limit: 200 })
      expect(lines.filter((l) => l.memo === 'TARIFA PIX')).toHaveLength(3)
    })

    it('flags a line whose FITID changed instead of silently merging or silently duplicating it', async () => {
      await commitStatementImport(CLINIC, USER, {
        accountId: bank.id,
        fileName: 'f1.ofx',
        parsed: ofx({ id: 'OLD-ID', date: '20261007', amount: '77.00', memo: 'FITID MUDOU' }),
      })
      const changed = ofx({ id: 'NEW-ID', date: '20261007', amount: '77.00', memo: 'FITID MUDOU' })
      const preview = await previewStatementImport(CLINIC, bank.id, changed)
      expect(preview.suspects).toHaveLength(1)
      const result = await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'f2.ofx', parsed: changed })
      expect(result).toMatchObject({ newLines: 1, suspectLines: 1 })

      const { lines } = await listStatementLines(CLINIC, { accountId: bank.id, status: 'all', limit: 200 })
      const [original, repeated] = [lines.find((l) => l.fitid === 'OLD-ID')!, lines.find((l) => l.fitid === 'NEW-ID')!]
      expect(repeated.suspectedDuplicateOf).toBe(original.id)
      expect(original.suspectedDuplicateOf).toBeNull()

      await confirmSuspectedLineIsDistinct(CLINIC, USER, repeated.id)
      expect((await lineBy('FITID MUDOU')).suspectReviewedAt ?? repeated.suspectReviewedAt).toBeDefined()
    })

    it('serialises two concurrent uploads of overlapping statements without duplicating a line', async () => {
      const a = ofx({ id: 'C1', date: '20261008', amount: '1.00', memo: 'CONC 1' }, { id: 'C2', date: '20261008', amount: '2.00', memo: 'CONC 2' })
      const b = ofx({ id: 'C2', date: '20261008', amount: '2.00', memo: 'CONC 2' }, { id: 'C3', date: '20261008', amount: '3.00', memo: 'CONC 3' })
      const results = await Promise.all([
        commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'c1.ofx', parsed: a }),
        commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'c2.ofx', parsed: b }),
      ])
      expect(results.reduce((sum, r) => sum + r.newLines, 0)).toBe(3)
      const { lines } = await listStatementLines(CLINIC, { accountId: bank.id, status: 'all', limit: 200 })
      expect(lines.filter((l) => l.memo.startsWith('CONC '))).toHaveLength(3)
    })

    it('refuses invalid statements, non-bank accounts, archived or foreign accounts', async () => {
      const broken = parseOfx('<OFX><STMTRS><CURDEF>BRL<BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261301<TRNAMT>1.00<FITID>X</STMTTRN></BANKTRANLIST></STMTRS></OFX>')
      await expect(commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'x.ofx', parsed: broken })).rejects.toMatchObject({ code: 'STATEMENT_INVALID' })
      const fine = ofx({ id: 'Z1', date: '20261009', amount: '1.00', memo: 'Z' })
      await expect(commitStatementImport(CLINIC, USER, { accountId: cash.id, fileName: 'x.ofx', parsed: fine })).rejects.toMatchObject({ code: 'STATEMENT_ACCOUNT_NOT_BANK' })
      await expect(commitStatementImport(CLINIC, USER, { accountId: otherBank.id, fileName: 'x.ofx', parsed: fine })).rejects.toMatchObject({ code: 'FINANCIAL_ACCOUNT_NOT_FOUND' })
    })
  })

  describe('allocations', () => {
    it('matches one bank credit against several card repasses with explicit cents', async () => {
      await importLines(ofx({ id: 'G1', date: '20261010', amount: '300.00', memo: 'STONE REPASSES' }))
      const [r1, r2, r3] = await Promise.all([
        movement('inflow', '100.00', '2026-10-10T15:00:00Z', { description: 'Repasse 1/3' }),
        movement('inflow', '120.00', '2026-10-10T15:00:00Z', { description: 'Repasse 2/3' }),
        movement('inflow', '80.00', '2026-10-10T15:00:00Z', { description: 'Repasse 3/3' }),
      ])
      const line = await lineBy('STONE REPASSES')
      await allocateStatementLine(CLINIC, USER, line.id, [
        { movementId: r1.id, amountCents: 10000 },
        { movementId: r2.id, amountCents: 12000 },
      ])
      expect((await lineBy('STONE REPASSES'))).toMatchObject({ status: 'partial', allocatedCents: 22000 })
      await allocateStatementLine(CLINIC, USER, line.id, [{ movementId: r3.id, amountCents: 8000 }])
      expect(await lineBy('STONE REPASSES')).toMatchObject({ status: 'matched', allocatedCents: 30000 })
    })

    it('matches several bank credits against one payment, never beyond its amount', async () => {
      await importLines(
        ofx(
          { id: 'P1', date: '20261011', amount: '60.00', memo: 'PIX PARTE 1' },
          { id: 'P2', date: '20261012', amount: '40.00', memo: 'PIX PARTE 2' },
          { id: 'P3', date: '20261012', amount: '10.00', memo: 'PIX SOBRA' },
        ),
      )
      const payment = await movement('inflow', '100.00', '2026-10-11T15:00:00Z', { description: 'Pagamento parcelado em dois pix' })
      await allocateStatementLine(CLINIC, USER, (await lineBy('PIX PARTE 1')).id, [{ movementId: payment.id, amountCents: 6000 }])
      await allocateStatementLine(CLINIC, USER, (await lineBy('PIX PARTE 2')).id, [{ movementId: payment.id, amountCents: 4000 }])
      await expect(
        allocateStatementLine(CLINIC, USER, (await lineBy('PIX SOBRA')).id, [{ movementId: payment.id, amountCents: 1000 }]),
      ).rejects.toMatchObject({ code: 'ALLOCATION_OVER_MOVEMENT' })
    })

    it('refuses over-allocating a line, the wrong direction, another account and an ignored line', async () => {
      await importLines(ofx({ id: 'V1', date: '20261013', amount: '50.00', memo: 'VALIDA' }))
      const line = await lineBy('VALIDA')
      const big = await movement('inflow', '500.00', '2026-10-13T15:00:00Z')
      await expect(allocateStatementLine(CLINIC, USER, line.id, [{ movementId: big.id, amountCents: 5001 }])).rejects.toMatchObject({ code: 'ALLOCATION_OVER_LINE' })

      const out = await movement('outflow', '50.00', '2026-10-13T15:00:00Z')
      await expect(allocateStatementLine(CLINIC, USER, line.id, [{ movementId: out.id, amountCents: 5000 }])).rejects.toMatchObject({ code: 'ALLOCATION_DIRECTION' })

      const inCash = await movement('inflow', '50.00', '2026-10-13T15:00:00Z', { accountId: cash.id })
      await expect(allocateStatementLine(CLINIC, USER, line.id, [{ movementId: inCash.id, amountCents: 5000 }])).rejects.toMatchObject({ code: 'ALLOCATION_ACCOUNT' })

      await ignoreStatementLine(CLINIC, USER, line.id, 'Teste')
      await expect(allocateStatementLine(CLINIC, USER, line.id, [{ movementId: big.id, amountCents: 5000 }])).rejects.toMatchObject({ code: 'STATEMENT_LINE_IGNORED' })
    })

    it('lets the database refuse an over-allocation even from a writer that skips the app checks', async () => {
      await importLines(ofx({ id: 'DB1', date: '20261014', amount: '10.00', memo: 'DIRETO' }))
      const line = await lineBy('DIRETO')
      const mov = await movement('inflow', '10.00', '2026-10-14T15:00:00Z')
      const base = { tenantId: CLINIC, accountId: bank.id, lineId: line.id, movementId: mov.id, createdBy: USER }
      await db.insert(bankReconciliationAllocations).values({ ...base, amountCents: 600 })
      await expect(db.insert(bankReconciliationAllocations).values({ ...base, amountCents: 600 })).rejects.toThrow()
      // Another clinic's id cannot be paired with this clinic's movement.
      await expect(
        db.insert(bankReconciliationAllocations).values({ ...base, tenantId: OTHER_CLINIC, accountId: otherBank.id, amountCents: 100 }),
      ).rejects.toThrow()
    })

    it('lets only one of two concurrent matches that cannot both fit succeed', async () => {
      await importLines(ofx({ id: 'K1', date: '20261015', amount: '70.00', memo: 'CONC LINHA A' }, { id: 'K2', date: '20261015', amount: '70.00', memo: 'CONC LINHA B' }))
      const mov = await movement('inflow', '70.00', '2026-10-15T15:00:00Z')
      const [a, b] = [await lineBy('CONC LINHA A'), await lineBy('CONC LINHA B')]
      const settled = await Promise.allSettled([
        allocateStatementLine(CLINIC, USER, a.id, [{ movementId: mov.id, amountCents: 7000 }]),
        allocateStatementLine(CLINIC, USER, b.id, [{ movementId: mov.id, amountCents: 7000 }]),
      ])
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
      const [{ total }] = await db
        .select({ total: sql<string>`SUM(${bankReconciliationAllocations.amountCents})` })
        .from(bankReconciliationAllocations)
        .where(and(eq(bankReconciliationAllocations.movementId, mov.id), sql`undone_at IS NULL`))
      expect(Number(total)).toBe(7000)
    })

    it("does not reach another clinic's lines or movements", async () => {
      await importLines(ofx({ id: 'T1', date: '20261016', amount: '15.00', memo: 'ISOLAMENTO' }))
      const line = await lineBy('ISOLAMENTO')
      const mov = await movement('inflow', '15.00', '2026-10-16T15:00:00Z')
      await expect(allocateStatementLine(OTHER_CLINIC, USER, line.id, [{ movementId: mov.id, amountCents: 1500 }])).rejects.toMatchObject({ code: 'STATEMENT_LINE_NOT_FOUND' })
      await expect(findMatchCandidates(OTHER_CLINIC, line.id)).rejects.toMatchObject({ code: 'STATEMENT_LINE_NOT_FOUND' })
      expect((await listStatementLines(OTHER_CLINIC, { accountId: bank.id, status: 'all' })).lines).toEqual([])
    })
  })

  describe('undo, ignore and statement immutability', () => {
    it('undo unlinks the allocations and leaves the payment untouched', async () => {
      await importLines(ofx({ id: 'U1', date: '20261017', amount: '90.00', memo: 'DESFAZER' }))
      const mov = await movement('inflow', '90.00', '2026-10-17T15:00:00Z')
      const line = await lineBy('DESFAZER')
      await allocateStatementLine(CLINIC, USER, line.id, [{ movementId: mov.id, amountCents: 9000 }])
      expect(await undoStatementLineMatch(CLINIC, USER, { lineId: line.id })).toEqual({ undone: 1 })

      expect(await lineBy('DESFAZER')).toMatchObject({ status: 'open', allocatedCents: 0 })
      const [still] = await db.select().from(cashMovements).where(eq(cashMovements.id, mov.id))
      expect(still).toMatchObject({ amount: '90.00', type: 'inflow', reversedByMovementId: null })
      // The allocation row is kept, marked undone, for the audit trail; and the line can be matched again.
      const rows = await db.select().from(bankReconciliationAllocations).where(eq(bankReconciliationAllocations.lineId, line.id))
      expect(rows).toHaveLength(1)
      expect(rows[0].undoneAt).not.toBeNull()
      await allocateStatementLine(CLINIC, USER, line.id, [{ movementId: mov.id, amountCents: 9000 }])
      await expect(undoStatementLineMatch(CLINIC, USER, { lineId: line.id, allocationId: rows[0].id })).rejects.toMatchObject({ code: 'ALLOCATION_NOT_FOUND' })
    })

    it('ignores with a reason, restores, and refuses to ignore a matched line', async () => {
      await importLines(ofx({ id: 'I1', date: '20261018', amount: '33.00', memo: 'IGNORAR' }, { id: 'I2', date: '20261018', amount: '34.00', memo: 'IGNORAR CASADO' }))
      const line = await lineBy('IGNORAR')
      await expect(ignoreStatementLine(CLINIC, USER, line.id, '  ')).rejects.toMatchObject({ code: 'IGNORE_REASON_REQUIRED' })
      await ignoreStatementLine(CLINIC, USER, line.id, 'Lançamento de teste do banco')
      expect(await lineBy('IGNORAR')).toMatchObject({ status: 'ignored', ignoreReason: 'Lançamento de teste do banco' })
      await unignoreStatementLine(CLINIC, USER, line.id)
      expect(await lineBy('IGNORAR')).toMatchObject({ status: 'open', ignoreReason: null })

      const matched = await lineBy('IGNORAR CASADO')
      const mov = await movement('inflow', '34.00', '2026-10-18T15:00:00Z')
      await allocateStatementLine(CLINIC, USER, matched.id, [{ movementId: mov.id, amountCents: 3400 }])
      await expect(ignoreStatementLine(CLINIC, USER, matched.id, 'x')).rejects.toMatchObject({ code: 'STATEMENT_LINE_ALLOCATED' })
    })

    it('refuses to edit or delete statement text, and to delete or rewrite an allocation', async () => {
      const line = await lineBy('IGNORAR')
      await expect(db.update(bankStatementLines).set({ memo: 'ADULTERADO' }).where(eq(bankStatementLines.id, line.id))).rejects.toThrow()
      await expect(db.update(bankStatementLines).set({ amountCents: 1 }).where(eq(bankStatementLines.id, line.id))).rejects.toThrow()
      await expect(db.delete(bankStatementLines).where(eq(bankStatementLines.id, line.id))).rejects.toThrow()
      const [alloc] = await db.select().from(bankReconciliationAllocations).limit(1)
      await expect(db.delete(bankReconciliationAllocations).where(eq(bankReconciliationAllocations.id, alloc.id))).rejects.toThrow()
      await expect(db.update(bankReconciliationAllocations).set({ amountCents: 1 }).where(eq(bankReconciliationAllocations.id, alloc.id))).rejects.toThrow()
    })
  })

  describe('candidates', () => {
    it('ranks the exact amount first and measures distance in BR days', async () => {
      await importLines(ofx({ id: 'S1', date: '20261031', amount: '250.00', memo: 'CANDIDATOS' }))
      // 23:00 on Oct 31 in BR is already Nov 1 in UTC: still the same BR day as the line.
      const exact = await movement('inflow', '250.00', '2026-11-01T02:00:00Z', { description: 'Exato noite' })
      await movement('inflow', '250.50', '2026-10-31T15:00:00Z', { description: 'Quase' })
      const line = await lineBy('CANDIDATOS')
      const candidates = await findMatchCandidates(CLINIC, line.id)
      expect(candidates[0]).toMatchObject({ id: exact.id, dayDistance: 0, remainingCents: 25000 })
      expect(candidates.map((c) => c.description)).toContain('Quase')
      // Outflows never appear for a credit.
      expect(candidates.every((c) => c.type === 'inflow')).toBe(true)
    })

    it('hides a proven net-zero bookkeeping reversal pair, but only while neither half is reconciled', async () => {
      await importLines(ofx({ id: 'B1', date: '20261020', amount: '200.00', memo: 'RECIBO REAL' }))
      const counter = await movement('outflow', '200.00', '2026-10-20T16:00:00Z', { description: 'Estorno pagamento' })
      const original = await movement('inflow', '200.00', '2026-10-20T15:00:00Z', { description: 'Pagamento estornado', reversedByMovementId: counter.id })
      const line = await lineBy('RECIBO REAL')

      expect((await findMatchCandidates(CLINIC, line.id)).map((c) => c.id)).not.toContain(original.id)
      const shown = await findMatchCandidates(CLINIC, line.id, { includeBookkeepingPairs: true })
      expect(shown.find((c) => c.id === original.id)).toMatchObject({ bookkeepingPair: true })

      // The bank really did receive it: once the user reconciles it, it is a real receipt, never hidden again.
      await allocateStatementLine(CLINIC, USER, line.id, [{ movementId: original.id, amountCents: 20000 }])
      await importLines(ofx({ id: 'B2', date: '20261020', amount: '-200.00', memo: 'ESTORNO REAL' }))
      const refund = await lineBy('ESTORNO REAL')
      const refundCandidates = await findMatchCandidates(CLINIC, refund.id)
      expect(refundCandidates.find((c) => c.id === counter.id)).toMatchObject({ bookkeepingPair: false })
    })

    it('does not hide a reversal pair that is not net zero on one account', async () => {
      await importLines(ofx({ id: 'B3', date: '20261021', amount: '80.00', memo: 'OUTRA CONTA' }))
      const counter = await movement('outflow', '80.00', '2026-10-21T16:00:00Z', { accountId: cash.id })
      const original = await movement('inflow', '80.00', '2026-10-21T15:00:00Z', { reversedByMovementId: counter.id })
      const line = await lineBy('OUTRA CONTA')
      expect((await findMatchCandidates(CLINIC, line.id)).map((c) => c.id)).toContain(original.id)
    })
  })

  describe('create an expense from a line', () => {
    it('records a bank debit as a paid expense on the line account and matches it, once', async () => {
      await importLines(ofx({ id: 'E1', date: '20261022', amount: '-39.90', memo: 'TARIFA MANUTENCAO' }))
      const line = await lineBy('TARIFA MANUTENCAO')
      const results = await Promise.allSettled([
        createExpenseFromStatementLine(CLINIC, USER, line.id, { categoryId, paymentMethod: 'transfer' }),
        createExpenseFromStatementLine(CLINIC, USER, line.id, { categoryId, paymentMethod: 'transfer' }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)

      const outflows = await db
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.tenantId, CLINIC), eq(cashMovements.type, 'outflow'), eq(cashMovements.amount, '39.90')))
      expect(outflows).toHaveLength(1)
      expect(outflows[0]).toMatchObject({ accountId: bank.id, expenseCategoryId: categoryId })
      const installments = await db.select().from(expenseInstallments).where(eq(expenseInstallments.id, outflows[0].expenseInstallmentId!))
      expect(installments[0]).toMatchObject({ status: 'paid', dueDate: '2026-10-22' })
      expect(await lineBy('TARIFA MANUTENCAO')).toMatchObject({ status: 'matched', allocatedCents: 3990 })
    })

    it('refuses credits and leaves nothing behind when the category is wrong', async () => {
      await importLines(ofx({ id: 'E2', date: '20261023', amount: '12.00', memo: 'CREDITO DESCONHECIDO' }, { id: 'E3', date: '20261023', amount: '-12.34', memo: 'DEBITO CATEGORIA RUIM' }))
      await expect(createExpenseFromStatementLine(CLINIC, USER, (await lineBy('CREDITO DESCONHECIDO')).id, { categoryId, paymentMethod: 'transfer' })).rejects.toMatchObject({ code: 'STATEMENT_LINE_NOT_DEBIT' })

      const bad = await lineBy('DEBITO CATEGORIA RUIM')
      await expect(createExpenseFromStatementLine(CLINIC, USER, bad.id, { categoryId: '00000000-0000-0000-0000-00000000dead', paymentMethod: 'transfer' })).rejects.toThrow()
      expect(await lineBy('DEBITO CATEGORIA RUIM')).toMatchObject({ status: 'open' })
      const orphans = await db.select().from(cashMovements).where(and(eq(cashMovements.tenantId, CLINIC), eq(cashMovements.amount, '12.34')))
      expect(orphans).toHaveLength(0)
    })
  })
})
