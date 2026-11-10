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
import { parseBrDate } from '@/lib/dates'
import { createFinancialAccount, type FinancialAccountRow } from '../financial-accounts'
import {
  allocateStatementLine,
  commitStatementImport,
  confirmSuspectedLineIsDistinct,
  createExpenseFromStatementLine,
  findMatchCandidates,
  findMatchCandidateResult,
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

function ofx(...rows: Array<{ id?: string; date: string; amount: string; memo: string; type?: string; check?: string }>) {
  const body = rows
    .map(
      (r) =>
        `<STMTTRN><TRNTYPE>${r.type ?? (r.check ? 'CHECK' : r.amount.startsWith('-') ? 'DEBIT' : 'CREDIT')}<DTPOSTED>${r.date}000000[-3:BRT]<TRNAMT>${r.amount}${r.id ? `<FITID>${r.id}` : ''}<MEMO>${r.memo}${r.check ? `<CHECKNUM>${r.check}` : ''}</STMTTRN>`,
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

    it('keeps cheques with different numbers apart, even with the same day, amount and memo', async () => {
      await importLines(ofx({ date: '20261009', amount: '-25.00', memo: 'CHEQUE COMPENSADO', check: '101' }))
      const next = ofx({ date: '20261009', amount: '-25.00', memo: 'CHEQUE COMPENSADO', check: '102' })
      const preview = await previewStatementImport(CLINIC, bank.id, next)
      expect(preview).toMatchObject({ alreadyImported: false, newLines: 1, duplicateLines: 0, suspects: [] })
      const result = await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'cheque.ofx', parsed: next })
      expect(result).toMatchObject({ alreadyImported: false, newLines: 1 })
      const { lines } = await listStatementLines(CLINIC, { accountId: bank.id, status: 'all', limit: 200 })
      expect(lines.filter((l) => l.memo === 'CHEQUE COMPENSADO')).toHaveLength(2)
    })

    it('imports a reused FITID with another payer and flags it for review instead of dropping it', async () => {
      await importLines(ofx({ id: 'REUSED', date: '20261011', amount: '45.00', memo: 'PIX ALICE' }))
      const bob = ofx({ id: 'REUSED', date: '20261011', amount: '45.00', memo: 'PIX BOB' })
      const preview = await previewStatementImport(CLINIC, bank.id, bob)
      expect(preview).toMatchObject({ alreadyImported: false, newLines: 1, duplicateLines: 0 })
      expect(preview.suspects).toEqual([expect.objectContaining({ memo: 'PIX BOB', reason: 'reused_fitid' })])

      const result = await commitStatementImport(CLINIC, USER, { accountId: bank.id, fileName: 'bob.ofx', parsed: bob })
      expect(result).toMatchObject({ newLines: 1, suspectLines: 1 })
      expect((await lineBy('PIX BOB')).suspectedDuplicateOf).toBe((await lineBy('PIX ALICE')).id)

      // The very same line again is still only a retry.
      const again = await previewStatementImport(CLINIC, bank.id, ofx({ id: 'REUSED', date: '20261011', amount: '45.00', memo: 'PIX ALICE' }))
      expect(again).toMatchObject({ newLines: 0, duplicateLines: 1 })
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

    it('keeps a received payment and its refund visible when both are on the statement, only labelled', async () => {
      await importLines(
        ofx({ id: 'B1', date: '20261020', amount: '200.00', memo: 'RECIBO REAL' }, { id: 'B2', date: '20261020', amount: '-200.00', memo: 'ESTORNO REAL' }),
      )
      const counter = await movement('outflow', '200.00', '2026-10-20T16:00:00Z', { description: 'Estorno pagamento' })
      const original = await movement('inflow', '200.00', '2026-10-20T15:00:00Z', { description: 'Pagamento estornado', reversedByMovementId: counter.id })

      // Neither half is reconciled yet: both still show up, without any toggle.
      const receipt = (await findMatchCandidates(CLINIC, (await lineBy('RECIBO REAL')).id)).find((c) => c.id === original.id)
      const refund = (await findMatchCandidates(CLINIC, (await lineBy('ESTORNO REAL')).id)).find((c) => c.id === counter.id)
      expect(receipt).toMatchObject({ reversalPair: true })
      expect(refund).toMatchObject({ reversalPair: true })

      await allocateStatementLine(CLINIC, USER, (await lineBy('RECIBO REAL')).id, [{ movementId: original.id, amountCents: 20000 }])
      await allocateStatementLine(CLINIC, USER, (await lineBy('ESTORNO REAL')).id, [{ movementId: counter.id, amountCents: 20000 }])
      expect(await lineBy('ESTORNO REAL')).toMatchObject({ status: 'matched' })
    })

    it('lists a reversal half after an otherwise equal ordinary movement', async () => {
      await importLines(ofx({ id: 'B3', date: '20261021', amount: '80.00', memo: 'ORDEM ESTORNO' }))
      const counter = await movement('outflow', '80.00', '2026-10-21T16:00:00Z')
      const reversed = await movement('inflow', '80.00', '2026-10-21T15:00:00Z', { reversedByMovementId: counter.id })
      const ordinary = await movement('inflow', '80.00', '2026-10-21T15:00:00Z')
      const ids = (await findMatchCandidates(CLINIC, (await lineBy('ORDEM ESTORNO')).id)).map((c) => c.id)
      expect(ids).toContain(reversed.id)
      expect(ids.indexOf(ordinary.id)).toBeLessThan(ids.indexOf(reversed.id))
    })
  })

  describe('explainable candidate retrieval', () => {
    async function fixture(memo = 'PIX MARIA JOSE SILVA') {
      const isolated = await createFinancialAccount(CLINIC, USER, account('bank', 'Sugestões'))
      const parsed = ofx({ id: 'SUGGEST', date: '20261102', amount: '250.00', memo })
      await commitStatementImport(CLINIC, USER, { accountId: isolated.id, fileName: 'suggestions.ofx', parsed })
      const { lines } = await listStatementLines(CLINIC, { accountId: isolated.id })
      return { isolated, line: lines[0] }
    }

    it('ranks description matches beyond the former first 50 and measures midnight in BR', async () => {
      const { isolated, line } = await fixture()
      await db.insert(cashMovements).values(Array.from({ length: 65 }, () => ({ tenantId: CLINIC, accountId: isolated.id, type: 'inflow' as const, amount: '250.00', description: 'Pagamento Ana Costa', movementDate: parseBrDate('2026-11-02'), recordedBy: USER })))
      // Older than the other 65 exact amounts in the former SQL ordering, but the same BR day.
      const best = await movement('inflow', '250.00', '2026-11-02T03:00:00Z', { accountId: isolated.id, description: 'Pagamento María José Silva' })
      const ranked = await findMatchCandidates(CLINIC, line.id)
      expect(ranked).toHaveLength(50)
      expect(ranked[0]).toMatchObject({ id: best.id, dayDistance: 0, confidence: 'high', suggested: true })
      expect(ranked.filter((r) => r.suggested)).toHaveLength(1)
      const nextDay = await movement('inflow', '250.00', '2026-11-03T02:59:59Z', { accountId: isolated.id, description: 'Pagamento María José Silva' })
      expect((await findMatchCandidates(CLINIC, line.id)).find((c) => c.id === nextDay.id)).toMatchObject({ dayDistance: 0, suggested: false })
      await movement('inflow', '250.00', '2026-11-03T03:00:00Z', { accountId: isolated.id, description: 'Pagamento María José Silva' })
      expect((await findMatchCandidates(CLINIC, line.id)).every((c) => !c.suggested)).toBe(true)
    })

    it('suppresses preselection when retrieval is truncated and keeps manual search outside 45 days', async () => {
      const { isolated, line } = await fixture()
      await db.insert(cashMovements).values(Array.from({ length: 501 }, () => ({ tenantId: CLINIC, accountId: isolated.id, type: 'inflow' as const, amount: '250.00', description: 'Pagamento Maria Jose Silva', movementDate: parseBrDate('2026-11-02'), recordedBy: USER })))
      expect((await findMatchCandidates(CLINIC, line.id)).every((c) => !c.suggested && c.confidence !== 'high' && c.reasons.some((r) => r.code === 'limited'))).toBe(true)
      const old = await movement('inflow', '250.00', '2026-08-01T15:00:00Z', { accountId: isolated.id, description: 'Pagamento Nome Antigo' })
      const searched = await findMatchCandidates(CLINIC, line.id, { search: 'Nome Antigo' })
      expect(searched).toHaveLength(1)
      expect(searched[0]).toMatchObject({ id: old.id, suggested: false })
    })

    it('isolates tenant, account and direction and never preselects partially used balances', async () => {
      const { isolated, line } = await fixture()
      const best = await movement('inflow', '250.00', '2026-11-02T15:00:00Z', { accountId: isolated.id, description: 'Pagamento Maria Jose Silva' })
      await movement('outflow', '250.00', '2026-11-02T15:00:00Z', { accountId: isolated.id, description: 'Pagamento Maria Jose Silva' })
      await movement('inflow', '250.00', '2026-11-02T15:00:00Z', { accountId: otherBank.id, tenantId: OTHER_CLINIC, description: 'Pagamento Maria Jose Silva' })
      const ranked = await findMatchCandidates(CLINIC, line.id)
      expect(ranked).toHaveLength(1)
      expect(ranked[0]).toMatchObject({ id: best.id, suggested: true })
      await expect(findMatchCandidates(OTHER_CLINIC, line.id)).rejects.toMatchObject({ code: 'STATEMENT_LINE_NOT_FOUND' })
      await allocateStatementLine(CLINIC, USER, line.id, [{ movementId: best.id, amountCents: 10000 }])
      expect((await findMatchCandidates(CLINIC, line.id))[0]).toMatchObject({ remainingCents: 15000, suggested: false, confidence: 'low' })
      await allocateStatementLine(CLINIC, USER, line.id, [{ movementId: best.id, amountCents: 15000 }])
      expect(await findMatchCandidateResult(CLINIC, line.id)).toEqual({ candidates: [], remainingCents: 0 })
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

    it('never creates a second expense for a line after its match was undone: it relinks the first', async () => {
      await importLines(ofx({ id: 'E4', date: '20261024', amount: '-18.73', memo: 'UMA TARIFA' }))
      const line = await lineBy('UMA TARIFA')
      const first = await createExpenseFromStatementLine(CLINIC, USER, line.id, { categoryId, paymentMethod: 'transfer' })
      expect(first.reused).toBe(false)
      expect(await lineBy('UMA TARIFA')).toMatchObject({ createdExpenseId: first.expenseId })

      await undoStatementLineMatch(CLINIC, USER, { lineId: line.id })
      const second = await createExpenseFromStatementLine(CLINIC, USER, line.id, { categoryId, paymentMethod: 'pix' })
      expect(second).toMatchObject({ expenseId: first.expenseId, movementId: first.movementId, reused: true })

      const outflows = await db.select().from(cashMovements).where(and(eq(cashMovements.tenantId, CLINIC), eq(cashMovements.amount, '18.73')))
      expect(outflows).toHaveLength(1)
      expect(await lineBy('UMA TARIFA')).toMatchObject({ status: 'matched', allocatedCents: 1873 })
    })

    it('points to the existing expense when its payment can no longer be relinked', async () => {
      await importLines(ofx({ id: 'E5', date: '20261025', amount: '-9.99', memo: 'TARIFA ESTORNADA' }))
      const line = await lineBy('TARIFA ESTORNADA')
      const first = await createExpenseFromStatementLine(CLINIC, USER, line.id, { categoryId, paymentMethod: 'transfer' })
      await undoStatementLineMatch(CLINIC, USER, { lineId: line.id })
      // Its payment was reverted in the ledger since.
      const [counter] = await db
        .insert(cashMovements)
        .values({ tenantId: CLINIC, accountId: bank.id, type: 'inflow', amount: '9.99', description: 'Estorno', movementDate: new Date(), recordedBy: USER })
        .returning()
      await db.update(cashMovements).set({ reversedByMovementId: counter.id }).where(eq(cashMovements.id, first.movementId))

      await expect(createExpenseFromStatementLine(CLINIC, USER, line.id, { categoryId, paymentMethod: 'transfer' })).rejects.toMatchObject({
        code: 'STATEMENT_LINE_EXPENSE_EXISTS',
      })
      const outflows = await db
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.tenantId, CLINIC), eq(cashMovements.type, 'outflow'), eq(cashMovements.amount, '9.99')))
      expect(outflows).toHaveLength(1)
      // The link itself cannot be cleared to make room for another expense.
      await expect(db.update(bankStatementLines).set({ createdExpenseId: null }).where(eq(bankStatementLines.id, line.id))).rejects.toThrow()
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
