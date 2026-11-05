import { randomUUID } from 'node:crypto'
import { db } from '@/db/client'
import { cashMovements, financialAccounts, type FinancialAccountKind } from '@/db/schema'
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import { BusinessError } from '@/lib/errors'
import { parseBrDate } from '@/lib/dates'
import type {
  CreateFinancialAccountInput,
  TransferInput,
  UpdateFinancialAccountInput,
} from '@/validations/financial-accounts'

export type FinancialAccountRow = typeof financialAccounts.$inferSelect
export type FinancialAccountWithBalance = FinancialAccountRow & { balance: number }

type DefaultKind = 'bank' | 'cash'

const notFound = () => new BusinessError('FINANCIAL_ACCOUNT_NOT_FOUND', 'Conta não encontrada ou arquivada')

const inTenant = (tenantId: string) => eq(financialAccounts.tenantId, tenantId)
const activeInTenant = (tenantId: string) => and(inTenant(tenantId), isNull(financialAccounts.archivedAt))

/** Cash goes to the drawer; every other method moves money through a bank. */
export function defaultKindForMethod(method: string | null | undefined): DefaultKind {
  return method === 'cash' ? 'cash' : 'bank'
}

const PROVISIONED_NAMES: Record<DefaultKind, string> = { cash: 'Caixa', bank: 'Banco' }

/** Same name 0050/0051 give the account holding movements from before accounts. */
const LEGACY_ACCOUNT_NAME = 'Geral (antes das contas)'

export interface AccountChoice {
  /** Picked by the user: must be an active account of this clinic. */
  accountId?: string | null
  /** A configured destination, like a card terminal's payout account. Skipped once archived. */
  preferredAccountId?: string | null
  /** Payment method of the movement, which decides the default account. */
  method?: string | null
}

/**
 * The account a new movement goes to. An explicit pick must belong to the
 * clinic and be active. Otherwise: the configured destination, then the
 * clinic's default account for the method's kind, then the legacy account of a
 * clinic that had movements before accounts existed. A clinic with none of
 * those gets its default "Caixa" or "Banco" created here, which is
 * the safety net for clinics created before accounts existed.
 */
export async function resolveMovementAccountId(
  tx: Pick<typeof db, 'select' | 'insert'>,
  tenantId: string,
  choice: AccountChoice,
): Promise<string> {
  if (choice.accountId) {
    const [picked] = await tx
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(and(activeInTenant(tenantId), eq(financialAccounts.id, choice.accountId)))
      .limit(1)
    if (!picked) throw notFound()
    return picked.id
  }

  const kind = defaultKindForMethod(choice.method)
  const active = await tx
    .select({ id: financialAccounts.id, kind: financialAccounts.kind, isDefault: financialAccounts.isDefault })
    .from(financialAccounts)
    .where(activeInTenant(tenantId))

  if (choice.preferredAccountId && active.some((a) => a.id === choice.preferredAccountId)) {
    return choice.preferredAccountId
  }
  const fallback =
    active.find((a) => a.isDefault && a.kind === kind) ?? active.find((a) => a.kind === 'legacy')
  if (fallback) return fallback.id

  return provisionDefaultAccount(tx, tenantId, kind)
}

/**
 * resolveMovementAccountId for many movements with no pick or configured
 * destination (seed and backfill scripts): the account only depends on the
 * method's kind, so each kind is resolved once.
 */
export function defaultAccountResolver(tx: Pick<typeof db, 'select' | 'insert'>, tenantId: string) {
  const byKind = new Map<DefaultKind, Promise<string>>()
  return (method: string | null | undefined): Promise<string> => {
    const kind = defaultKindForMethod(method)
    let id = byKind.get(kind)
    if (!id) {
      id = resolveMovementAccountId(tx, tenantId, { method })
      byKind.set(kind, id)
    }
    return id
  }
}

/** Every clinic starts with a cash drawer and a bank account, so nobody sets up accounts before the first payment. */
export async function provisionDefaultAccounts(tx: Pick<typeof db, 'select' | 'insert'>, tenantId: string): Promise<void> {
  await provisionDefaultAccount(tx, tenantId, 'cash')
  await provisionDefaultAccount(tx, tenantId, 'bank')
}

async function provisionDefaultAccount(tx: Pick<typeof db, 'select' | 'insert'>, tenantId: string, kind: DefaultKind): Promise<string> {
  // uq_financial_accounts_default makes a concurrent first payment a no-op
  // here; the select below then reads the row the other one committed.
  await tx
    .insert(financialAccounts)
    .values({ tenantId, kind, name: PROVISIONED_NAMES[kind], isDefault: true })
    .onConflictDoNothing()
  const [row] = await tx
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(and(activeInTenant(tenantId), eq(financialAccounts.kind, kind), eq(financialAccounts.isDefault, true)))
    .limit(1)
  if (!row) throw new Error(`Default ${kind} account for tenant ${tenantId} was not provisioned`)
  return row.id
}

/**
 * The account a reversal goes to: the original movement's, even if it was
 * archived since, so the reversal undoes the money where it landed. An
 * original that old code wrote without an account (between 0050 and 0051) is
 * attributed to the legacy account by the 0051 catch-up, so the reversal goes
 * there too, never to a method default: otherwise a fully reversed payment
 * would leave +amount on legacy and -amount on the bank. A clinic whose first
 * movement came from old code after 0050 has no legacy account yet, so it is
 * created here, the same row 0051 would create.
 */
export async function reversalAccountId(
  tx: Pick<typeof db, 'select' | 'insert'>,
  tenantId: string,
  originalAccountId: string | null | undefined,
): Promise<string> {
  if (originalAccountId) return originalAccountId
  return ensureLegacyAccount(tx, tenantId)
}

async function ensureLegacyAccount(tx: Pick<typeof db, 'select' | 'insert'>, tenantId: string): Promise<string> {
  // uq_financial_accounts_legacy makes a concurrent reversal or 0051 a no-op
  // here; the select below then reads the row the other one committed.
  await tx
    .insert(financialAccounts)
    .values({ tenantId, kind: 'legacy', name: LEGACY_ACCOUNT_NAME })
    .onConflictDoNothing()
  const [legacy] = await tx
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(and(inTenant(tenantId), eq(financialAccounts.kind, 'legacy')))
    .limit(1)
  if (!legacy) throw new Error(`Legacy account for tenant ${tenantId} was not provisioned`)
  return legacy.id
}

/** The account of the live inflow a payment record wrote, for its reversal. */
export async function paymentInflowAccountId(
  tx: Pick<typeof db, 'select' | 'insert'>,
  tenantId: string,
  paymentRecordId: string,
): Promise<string> {
  const [original] = await tx
    .select({ accountId: cashMovements.accountId })
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.tenantId, tenantId),
        eq(cashMovements.paymentRecordId, paymentRecordId),
        eq(cashMovements.type, 'inflow'),
      ),
    )
    .orderBy(desc(cashMovements.recordedAt))
    .limit(1)
  return reversalAccountId(tx, tenantId, original?.accountId)
}

// ─── BALANCES ────────────────────────────────────────────────────────

const signedAmount = sql`CASE WHEN ${cashMovements.type} = 'inflow' THEN ${cashMovements.amount}::numeric ELSE -${cashMovements.amount}::numeric END`

// The opening balance is what the account held at the start of its BR day, so
// movements dated before it are already inside it and are not added again.
const sinceOpening = sql`(${financialAccounts.openingBalanceDate} IS NULL OR ${cashMovements.movementDate} >= (${financialAccounts.openingBalanceDate}::timestamp AT TIME ZONE 'America/Sao_Paulo'))`

const KIND_ORDER = sql`CASE ${financialAccounts.kind} WHEN 'bank' THEN 0 WHEN 'cash' THEN 1 WHEN 'acquirer' THEN 2 ELSE 3 END`

export async function listFinancialAccounts(
  tenantId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<FinancialAccountWithBalance[]> {
  const rows = await db
    .select({
      ...getTableColumns(financialAccounts),
      balance: sql<string>`${financialAccounts.openingBalance} + COALESCE(SUM(${signedAmount}) FILTER (WHERE ${sinceOpening}), 0)`,
    })
    .from(financialAccounts)
    .leftJoin(
      cashMovements,
      and(eq(cashMovements.accountId, financialAccounts.id), eq(cashMovements.tenantId, financialAccounts.tenantId)),
    )
    .where(opts.includeArchived ? inTenant(tenantId) : activeInTenant(tenantId))
    .groupBy(financialAccounts.id)
    .orderBy(sql`${financialAccounts.archivedAt} IS NOT NULL`, KIND_ORDER, desc(financialAccounts.isDefault), asc(financialAccounts.name))

  return rows.map((row) => ({ ...row, balance: Number(row.balance) }))
}

// ─── MANAGEMENT ──────────────────────────────────────────────────────

function openingColumns(data: { openingBalance: number; openingBalanceDate?: string | null }) {
  return {
    openingBalance: data.openingBalance.toFixed(2),
    openingBalanceDate: data.openingBalanceDate ?? null,
  }
}

async function clearDefault(tx: typeof db, tenantId: string, kind: FinancialAccountKind) {
  await tx
    .update(financialAccounts)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(activeInTenant(tenantId), eq(financialAccounts.kind, kind), eq(financialAccounts.isDefault, true)))
}

async function lockAccount(tx: typeof db, tenantId: string, id: string) {
  const [account] = await tx
    .select()
    .from(financialAccounts)
    .where(and(inTenant(tenantId), eq(financialAccounts.id, id)))
    .for('update')
  if (!account) throw notFound()
  return account
}

export async function createFinancialAccount(tenantId: string, userId: string, data: CreateFinancialAccountInput) {
  return withTransaction(async (tx) => {
    // The first bank or cash account of a clinic becomes the default of its
    // kind, like the first card terminal does; otherwise the next payment
    // would land on the legacy account or on a provisioned one next to it.
    let isDefault = data.isDefault
    if (data.isDefault) {
      await clearDefault(tx, tenantId, data.kind)
    } else if (data.kind === 'bank' || data.kind === 'cash') {
      const [current] = await tx
        .select({ id: financialAccounts.id })
        .from(financialAccounts)
        .where(and(activeInTenant(tenantId), eq(financialAccounts.kind, data.kind), eq(financialAccounts.isDefault, true)))
        .limit(1)
      isDefault = !current
    }

    const [account] = await tx
      .insert(financialAccounts)
      .values({
        tenantId,
        kind: data.kind,
        name: data.name,
        bankName: data.bankName ?? null,
        bankAgency: data.bankAgency ?? null,
        bankAccount: data.bankAccount ?? null,
        isDefault,
        ...openingColumns(data),
      })
      .returning()

    await createAuditLog(
      { tenantId, userId, action: 'create', entityType: 'financial_account', entityId: account.id },
      tx,
    )
    return account
  })
}

export async function updateFinancialAccount(
  tenantId: string,
  userId: string,
  id: string,
  data: UpdateFinancialAccountInput,
) {
  return withTransaction(async (tx) => {
    const current = await lockAccount(tx, tenantId, id)
    if (current.archivedAt) throw notFound()

    // The legacy account holds history; its only editable detail is the name.
    // An opening balance on it would count that history twice.
    if (current.kind === 'legacy') {
      const [account] = await tx
        .update(financialAccounts)
        .set({ name: data.name, updatedAt: new Date() })
        .where(and(inTenant(tenantId), eq(financialAccounts.id, id)))
        .returning()
      await createAuditLog(
        { tenantId, userId, action: 'update', entityType: 'financial_account', entityId: id },
        tx,
      )
      return account
    }

    const isDefault = data.isDefault && (current.kind === 'bank' || current.kind === 'cash')
    if (isDefault && !current.isDefault) await clearDefault(tx, tenantId, current.kind)

    const [account] = await tx
      .update(financialAccounts)
      .set({
        name: data.name,
        bankName: data.bankName ?? null,
        bankAgency: data.bankAgency ?? null,
        bankAccount: data.bankAccount ?? null,
        isDefault,
        ...openingColumns(data),
        updatedAt: new Date(),
      })
      .where(and(inTenant(tenantId), eq(financialAccounts.id, id)))
      .returning()

    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'financial_account',
        entityId: id,
        changes: {
          openingBalance: { old: current.openingBalance, new: account.openingBalance },
          openingBalanceDate: { old: current.openingBalanceDate, new: account.openingBalanceDate },
        },
      },
      tx,
    )
    return account
  })
}

/**
 * Archived accounts keep every movement and terminal that references them;
 * they only stop being offered and stop receiving defaults.
 */
export async function setFinancialAccountArchived(
  tenantId: string,
  userId: string,
  id: string,
  archived: boolean,
) {
  return withTransaction(async (tx) => {
    const current = await lockAccount(tx, tenantId, id)
    if (Boolean(current.archivedAt) === archived) return current

    const [account] = await tx
      .update(financialAccounts)
      .set(archived ? { archivedAt: new Date(), isDefault: false, updatedAt: new Date() } : { archivedAt: null, updatedAt: new Date() })
      .where(and(inTenant(tenantId), eq(financialAccounts.id, id)))
      .returning()

    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'financial_account',
        entityId: id,
        changes: { archived: { old: !archived, new: archived } },
      },
      tx,
    )
    return account
  })
}

// ─── TRANSFERS ───────────────────────────────────────────────────────

/**
 * Moves money between two of the clinic's accounts: one outflow and one inflow
 * sharing a transfer_group_id, written by a single statement so neither leg
 * can exist without the other. Both legs stay out of revenue and expense totals.
 */
export async function createTransfer(tenantId: string, userId: string, data: TransferInput) {
  if (data.fromAccountId === data.toAccountId) {
    throw new BusinessError('TRANSFER_SAME_ACCOUNT', 'Escolha contas diferentes para a transferência')
  }

  return withTransaction(async (tx) => {
    const accounts = await tx
      .select({ id: financialAccounts.id, name: financialAccounts.name })
      .from(financialAccounts)
      .where(and(activeInTenant(tenantId), inArray(financialAccounts.id, [data.fromAccountId, data.toAccountId])))
      .orderBy(asc(financialAccounts.id))
      .for('update')
    const from = accounts.find((a) => a.id === data.fromAccountId)
    const to = accounts.find((a) => a.id === data.toAccountId)
    if (!from || !to) throw notFound()

    const transferGroupId = randomUUID()
    const amount = data.amount.toFixed(2)
    const movementDate = parseBrDate(data.date, '12:00:00')
    const description = data.description?.trim() || `Transferência: ${from.name} → ${to.name}`
    const leg = { tenantId, amount, description, paymentMethod: null, movementDate, recordedBy: userId, transferGroupId }

    await tx.insert(cashMovements).values([
      { ...leg, type: 'outflow', accountId: from.id },
      { ...leg, type: 'inflow', accountId: to.id },
    ])

    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'create',
        entityType: 'financial_transfer',
        entityId: transferGroupId,
        changes: {
          transfer: { old: null, new: { fromAccountId: from.id, toAccountId: to.id, amount, date: data.date } },
        },
      },
      tx,
    )

    return { transferGroupId }
  })
}
