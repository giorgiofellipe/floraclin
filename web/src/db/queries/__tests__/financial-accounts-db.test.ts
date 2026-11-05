import { beforeAll, describe, expect, it } from 'vitest'
import { and, count, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { cashMovements, tenants, users } from '@/db/schema'
import {
  createFinancialAccount,
  createTransfer,
  listFinancialAccounts,
  resolveMovementAccountId,
  reversalAccountId,
  setFinancialAccountArchived,
  type FinancialAccountRow,
} from '../financial-accounts'
import { exportLedgerCSV, getLedgerSummary, listCashMovements } from '../cash-movements'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const CLINIC = '00000000-0000-0000-0000-0000000fa001'
const OTHER_CLINIC = '00000000-0000-0000-0000-0000000fa002'
const NEW_CLINIC = '00000000-0000-0000-0000-0000000fa003'
const USER = '00000000-0000-0000-0000-0000000fa004'

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
