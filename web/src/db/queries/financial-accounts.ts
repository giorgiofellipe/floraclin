import { randomUUID } from 'node:crypto'
import { db } from '@/db/client'
import { bankReconciliationAllocations, cashMovements, financialAccounts, type FinancialAccountKind } from '@/db/schema'
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import { BusinessError } from '@/lib/errors'
import { endOfBrDay, parseBrDate, startOfBrDay } from '@/lib/dates'
import type {
  CreateFinancialAccountInput,
  MoveMovementsInput,
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

/**
 * The account of the live inflow a payment record wrote, for its reversal.
 * Locks the inflow until the reversal commits: moveMovementsToAccount locks it
 * too, so a move either sees the finished pair and moves both halves, or
 * finishes first and the counter lands on the new account.
 */
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
    .for('update')
  return reversalAccountId(tx, tenantId, original?.accountId)
}

/**
 * The live outflow an expense installment's payment wrote and the account its
 * reversal goes to. Locks the outflow like paymentInflowAccountId does: the
 * account is read behind the lock, so a move that commits first is seen and
 * the counter follows it; a move that comes later sees the finished pair.
 */
export async function expenseOutflowForReversal(
  tx: Pick<typeof db, 'select' | 'insert'>,
  tenantId: string,
  installmentId: string,
): Promise<{ movementId: string | null; accountId: string }> {
  const [original] = await tx
    .select({ id: cashMovements.id, accountId: cashMovements.accountId })
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.tenantId, tenantId),
        eq(cashMovements.expenseInstallmentId, installmentId),
        eq(cashMovements.type, 'outflow'),
        isNull(cashMovements.reversedByMovementId),
      ),
    )
    .orderBy(desc(cashMovements.recordedAt))
    .limit(1)
    .for('update')
  return { movementId: original?.id ?? null, accountId: await reversalAccountId(tx, tenantId, original?.accountId) }
}

export interface PaymentMovement {
  movementId: string
  accountId: string | null
  /** Matched to a bank statement line: it can't change account until undone. */
  isReconciled: boolean
}

/**
 * The inflow each payment wrote, keyed by payment record, so the payment
 * history can offer "Trocar conta". Card payments have none: their money lands
 * through repasses, on the terminal's account.
 */
export async function getPaymentMovements(
  tenantId: string,
  paymentRecordIds: string[],
): Promise<Map<string, PaymentMovement>> {
  const byPayment = new Map<string, PaymentMovement>()
  if (!paymentRecordIds.length) return byPayment
  const rows = await db
    .select({
      movementId: cashMovements.id,
      paymentRecordId: cashMovements.paymentRecordId,
      accountId: cashMovements.accountId,
      isReconciled: sql<boolean>`EXISTS (
        SELECT 1 FROM floraclin.bank_reconciliation_allocations bra
        WHERE bra.tenant_id = ${cashMovements.tenantId}
          AND bra.movement_id = ${cashMovements.id}
          AND bra.undone_at IS NULL
      )`,
    })
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.tenantId, tenantId),
        inArray(cashMovements.paymentRecordId, paymentRecordIds),
        eq(cashMovements.type, 'inflow'),
        isNull(cashMovements.transferGroupId),
      ),
    )
    .orderBy(desc(cashMovements.recordedAt))
  // Newest first, like paymentInflowAccountId: the first row per payment wins.
  for (const { paymentRecordId, ...movement } of rows) {
    if (paymentRecordId && !byPayment.has(paymentRecordId)) byPayment.set(paymentRecordId, movement)
  }
  return byPayment
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

// ─── MOVING MOVEMENTS BETWEEN ACCOUNTS ───────────────────────────────

export interface MoveMovementsResult {
  moved: number
  /** Matched to a bank statement line: undo the reconciliation first. */
  skippedReconciled: number
  /** Internal transfers have their own two legs; they are not payments. */
  skippedTransfers: number
}

export interface MoveMovementsPreview extends MoveMovementsResult {
  /** What the source balances lose and the target gains (inflows minus outflows), e.g. "1250.00". */
  total: string
}

type Tx = typeof db

const movementRow = {
  id: cashMovements.id,
  type: cashMovements.type,
  amount: cashMovements.amount,
  accountId: cashMovements.accountId,
  transferGroupId: cashMovements.transferGroupId,
  reversedByMovementId: cashMovements.reversedByMovementId,
}

type MovementRow = { [K in keyof typeof movementRow]: (typeof cashMovements.$inferSelect)[K] }

/** The rows plus the other half of each reversal pair: the original points at its counter through reversed_by_movement_id. */
function withPairs(tenantId: string, ids: string[]) {
  return and(
    eq(cashMovements.tenantId, tenantId),
    or(
      inArray(cashMovements.id, ids),
      inArray(cashMovements.reversedByMovementId, ids),
      sql`${cashMovements.id} IN (
        SELECT reversed_by_movement_id FROM floraclin.cash_movements
        WHERE tenant_id = ${tenantId} AND id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
          AND reversed_by_movement_id IS NOT NULL)`,
    ),
  )
}

/**
 * Picks the movements a move covers and decides which ones go. With `lock`,
 * the picked rows and the other half of each pair are found first and then
 * locked in one statement, in id order like allocateStatementLine: locking
 * the picked half before finding its pair would let a match or another move
 * hold one half while waiting on the other. Once they are locked, neither a
 * concurrent match nor a concurrent reversal can slip between this read and
 * the update.
 */
async function planMove(tx: Tx, tenantId: string, targetId: string, data: MoveMovementsInput, lock: boolean) {
  const pickWhere = and(
    eq(cashMovements.tenantId, tenantId),
    data.movementIds
      ? inArray(cashMovements.id, data.movementIds)
      : and(
          eq(cashMovements.accountId, data.fromAccountId!),
          data.dateFrom ? gte(cashMovements.movementDate, startOfBrDay(data.dateFrom)) : undefined,
          data.dateTo ? lte(cashMovements.movementDate, endOfBrDay(data.dateTo)) : undefined,
        ),
  )
  const read = async () => {
    const picked = (await tx
      .select(movementRow)
      .from(cashMovements)
      .where(pickWhere)
      .orderBy(asc(cashMovements.id))) as MovementRow[]
    if (data.movementIds && picked.length !== new Set(data.movementIds).size) throw notFound()
    const pickedIds = picked.filter((m) => !m.transferGroupId).map((m) => m.id)
    const rows = pickedIds.length
      ? ((await tx
          .select(movementRow)
          .from(cashMovements)
          .where(withPairs(tenantId, pickedIds))
          .orderBy(asc(cashMovements.id))) as MovementRow[])
      : []
    return { picked, rows }
  }

  let { picked, rows } = await read()
  if (lock) {
    // A row committed while this transaction waited for a lock (a reversal's
    // counter, a payment landing in the period) is only visible to a later
    // statement: read again behind the locks and lock what is new, until
    // nothing is. A reversal locks the original before writing its counter
    // (paymentInflowAccountId, expenseOutflowForReversal), so once the
    // originals are locked no new pair can form.
    const locked = new Set<string>()
    for (;;) {
      const fresh = rows.map((r) => r.id).filter((id) => !locked.has(id))
      if (!fresh.length) break
      await tx
        .select({ id: cashMovements.id })
        .from(cashMovements)
        .where(and(eq(cashMovements.tenantId, tenantId), inArray(cashMovements.id, fresh)))
        .orderBy(asc(cashMovements.id))
        .for('update')
      for (const id of fresh) locked.add(id)
      ;({ picked, rows } = await read())
    }
  }

  const skippedTransfers = picked.filter((m) => m.transferGroupId).length
  if (!rows.length) return { rows, toMove: [] as MovementRow[], moved: 0, skippedReconciled: 0, skippedTransfers }

  // Group each row with its pair so the pair is moved or skipped as one.
  const groupOf = new Map<string, string>()
  for (const r of rows) {
    groupOf.set(r.id, groupOf.get(r.id) ?? r.id)
    if (r.reversedByMovementId) groupOf.set(r.reversedByMovementId, groupOf.get(r.id)!)
  }

  // Read behind the locks: allocateStatementLine locks the movement before it
  // writes an allocation, so none can appear for these rows from here on.
  const reconciledRows = await tx
    .select({ movementId: bankReconciliationAllocations.movementId })
    .from(bankReconciliationAllocations)
    .where(
      and(
        eq(bankReconciliationAllocations.tenantId, tenantId),
        inArray(bankReconciliationAllocations.movementId, rows.map((r) => r.id)),
        isNull(bankReconciliationAllocations.undoneAt),
      ),
    )
  const blockedGroups = new Set(reconciledRows.map((r) => groupOf.get(r.movementId)))

  const toMove = rows.filter((r) => !blockedGroups.has(groupOf.get(r.id)) && r.accountId !== targetId)
  // Counted per pair, so a skipped reversed payment reads as one.
  const skippedReconciled = new Set(
    rows.filter((r) => blockedGroups.has(groupOf.get(r.id))).map((r) => groupOf.get(r.id)),
  ).size
  const moved = new Set(toMove.map((r) => groupOf.get(r.id))).size
  return { rows, toMove, moved, skippedReconciled, skippedTransfers }
}

async function lockTarget(tx: Tx, tenantId: string, toAccountId: string, lock: boolean) {
  // The legacy account only holds history: money can leave it, never land on it.
  const query = tx
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(and(activeInTenant(tenantId), eq(financialAccounts.id, toAccountId), ne(financialAccounts.kind, 'legacy')))
    .limit(1)
  // SHARE holds off an archive but not the key-share lock that a reversal's or
  // an allocation's foreign key takes on this account while holding a movement
  // this move waits for: FOR UPDATE here would deadlock with them.
  const [target] = lock ? await query.for('share') : await query
  if (!target) throw notFound()
  return target
}

/** What moveMovementsToAccount would do, without writing: shown before the user confirms. */
export async function previewMoveMovements(tenantId: string, data: MoveMovementsInput): Promise<MoveMovementsPreview> {
  const target = await lockTarget(db, tenantId, data.toAccountId, false)
  const { toMove, moved, skippedReconciled, skippedTransfers } = await planMove(db, tenantId, target.id, data, false)
  const cents = toMove.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100) * (r.type === 'inflow' ? 1 : -1), 0)
  return { moved, skippedReconciled, skippedTransfers, total: (cents / 100).toFixed(2) }
}

/**
 * Re-points movements at another account, for a payment registered on the
 * wrong one. Only account_id changes (amount, date and links are untouched)
 * and the move is audited with each movement's previous account. A reversal
 * pair always moves together, so a reversed payment never leaves +amount on
 * one account and -amount on another. Movements matched to a bank statement
 * line and transfer legs are skipped and counted.
 */
export async function moveMovementsToAccount(
  tenantId: string,
  userId: string,
  data: MoveMovementsInput,
): Promise<MoveMovementsResult> {
  return withTransaction(async (tx) => {
    // One move at a time per clinic. Moves lock in id order, but one that
    // finds a new counter after locking has to lock it out of order.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('floraclin.move_movements'), hashtext(${tenantId}))`)
    const target = await lockTarget(tx, tenantId, data.toAccountId, true)
    const { toMove, moved, skippedReconciled, skippedTransfers } = await planMove(tx, tenantId, target.id, data, true)

    if (toMove.length) {
      await tx
        .update(cashMovements)
        .set({ accountId: target.id })
        .where(and(eq(cashMovements.tenantId, tenantId), inArray(cashMovements.id, toMove.map((r) => r.id))))

      await createAuditLog(
        {
          tenantId,
          userId,
          action: 'update',
          entityType: 'cash_movement_account',
          entityId: randomUUID(),
          changes: {
            // Movement id → its account before the move, so each one can be put back.
            accountId: { old: Object.fromEntries(toMove.map((r) => [r.id, r.accountId])), new: target.id },
          },
        },
        tx,
      )
    }

    return { moved, skippedReconciled, skippedTransfers }
  })
}
