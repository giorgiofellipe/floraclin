import { db } from '@/db/client'
import {
  bankReconciliationAllocations,
  bankStatementImports,
  bankStatementLines,
  cashMovements,
  expenseInstallments,
  financialAccounts,
} from '@/db/schema'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import { BusinessError } from '@/lib/errors'
import { parseBrDate } from '@/lib/dates'
import {
  lineFingerprint,
  lineIdentityKey,
  statementHash,
  type OfxTransaction,
  type ParsedOfx,
} from '@/lib/financial/ofx'
import { createExpense, payExpenseInstallment } from './expenses'

type Tx = typeof db

const CHUNK = 500

const lineNotFound = () => new BusinessError('STATEMENT_LINE_NOT_FOUND', 'Lançamento do extrato não encontrado')
const accountNotFound = () => new BusinessError('FINANCIAL_ACCOUNT_NOT_FOUND', 'Conta não encontrada ou arquivada')

/** A Postgres error code, whether the driver put it on the error or on its cause. */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null
  const code = e?.code ?? e?.cause?.code
  return typeof code === 'string' ? code : undefined
}

/** Lines whose allocations the database refused (over-allocation, other account, wrong direction). */
function asAllocationConflict(error: unknown): never {
  const code = pgCode(error)
  if (code === '23514' || code === '23503') {
    throw new BusinessError(
      'ALLOCATION_CONFLICT',
      'Não foi possível conciliar: o lançamento ou a movimentação já foi usado por outra conciliação ou não é compatível',
    )
  }
  throw error
}

// Correlated subqueries name the outer table explicitly: drizzle drops the table
// qualifier from column references in a single-table select, which would bind
// them to the subquery's own alias instead.
const allocatedToLine = sql<string>`COALESCE((SELECT SUM(a.amount_cents) FROM floraclin.bank_reconciliation_allocations a WHERE a.tenant_id = "bank_statement_lines"."tenant_id" AND a.line_id = "bank_statement_lines"."id" AND a.undone_at IS NULL), 0)`

// ─── IMPORT ──────────────────────────────────────────────────────────

export interface ImportSuspect {
  index: number
  date: string
  amountCents: number
  memo: string
  suspectedDuplicateOf: string
}

export interface ImportPreview {
  total: number
  newLines: number
  duplicateLines: number
  suspects: ImportSuspect[]
  /** True when this exact statement was already imported into the account. */
  alreadyImported: boolean
  warnings: string[]
  periodStart: string | null
  periodEnd: string | null
}

interface PlannedLine extends OfxTransaction {
  identityKey: string
  fingerprint: string
  occurrence: number
  suspectedDuplicateOf: string | null
}

async function lockBankAccount(tx: Tx, tenantId: string, accountId: string) {
  const [account] = await tx
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.tenantId, tenantId), eq(financialAccounts.id, accountId), isNull(financialAccounts.archivedAt)))
    .for('update')
  if (!account) throw accountNotFound()
  if (account.kind !== 'bank') {
    throw new BusinessError('STATEMENT_ACCOUNT_NOT_BANK', 'O extrato só pode ser importado em uma conta bancária')
  }
  return account
}

/**
 * Works out which lines of a file are new. Each line gets an identity (see
 * lineIdentityKey) and an occurrence number: identical lines in one file keep
 * their multiplicity (1st, 2nd...), and a re-upload only skips the slots that
 * already exist, so legitimate identical same-day transactions are never merged.
 * A new line that merely shares day, amount and memo with an older line under
 * a different identity (the bank changed its FITID) is imported but flagged.
 */
async function planImport(tx: Tx, tenantId: string, accountId: string, transactions: readonly OfxTransaction[]) {
  const seen = new Map<string, number>()
  const planned: PlannedLine[] = transactions.map((t) => {
    const identityKey = lineIdentityKey(t)
    const occurrence = (seen.get(identityKey) ?? 0) + 1
    seen.set(identityKey, occurrence)
    return { ...t, identityKey, fingerprint: lineFingerprint(t), occurrence, suspectedDuplicateOf: null }
  })

  const existingSlots = new Set<string>()
  const keys = [...seen.keys()]
  for (let i = 0; i < keys.length; i += CHUNK) {
    const rows = await tx
      .select({ identityKey: bankStatementLines.identityKey, occurrence: bankStatementLines.occurrence })
      .from(bankStatementLines)
      .where(
        and(
          eq(bankStatementLines.tenantId, tenantId),
          eq(bankStatementLines.accountId, accountId),
          inArray(bankStatementLines.identityKey, keys.slice(i, i + CHUNK)),
        ),
      )
    for (const row of rows) existingSlots.add(`${row.identityKey}:${row.occurrence}`)
  }

  const fresh = planned.filter((p) => !existingSlots.has(`${p.identityKey}:${p.occurrence}`))

  const fingerprints = [...new Set(fresh.map((p) => p.fingerprint))]
  const oldestByFingerprint = new Map<string, string>()
  for (let i = 0; i < fingerprints.length; i += CHUNK) {
    const rows = await tx
      .select({ id: bankStatementLines.id, fingerprint: bankStatementLines.fingerprint })
      .from(bankStatementLines)
      .where(
        and(
          eq(bankStatementLines.tenantId, tenantId),
          eq(bankStatementLines.accountId, accountId),
          inArray(bankStatementLines.fingerprint, fingerprints.slice(i, i + CHUNK)),
        ),
      )
      .orderBy(asc(bankStatementLines.createdAt), asc(bankStatementLines.id))
    for (const row of rows) if (!oldestByFingerprint.has(row.fingerprint)) oldestByFingerprint.set(row.fingerprint, row.id)
  }
  for (const line of fresh) line.suspectedDuplicateOf = oldestByFingerprint.get(line.fingerprint) ?? null

  return { planned, fresh }
}

function accountWarnings(account: typeof financialAccounts.$inferSelect, parsed: ParsedOfx): string[] {
  const warnings: string[] = []
  const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if (account.bankAccount && parsed.accountId && digits(account.bankAccount) !== digits(parsed.accountId)) {
    warnings.push(
      `A conta do arquivo (${parsed.accountId}) é diferente da conta selecionada (${account.bankAccount}). Confira se escolheu a conta certa`,
    )
  }
  return warnings
}

function assertImportable(parsed: ParsedOfx) {
  if (parsed.fileErrors.length > 0) throw new BusinessError('STATEMENT_INVALID', parsed.fileErrors[0])
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]
    throw new BusinessError(
      'STATEMENT_INVALID',
      `${parsed.errors.length} lançamento(s) inválido(s) no arquivo. Primeiro: registro ${first.index} — ${first.message}`,
    )
  }
}

/** What an import would do, without writing anything. */
export async function previewStatementImport(tenantId: string, accountId: string, parsed: ParsedOfx): Promise<ImportPreview> {
  assertImportable(parsed)
  const account = await findBankAccount(tenantId, accountId)
  const hash = statementHash(parsed.transactions)
  const [already] = await db
    .select({ id: bankStatementImports.id })
    .from(bankStatementImports)
    .where(
      and(
        eq(bankStatementImports.tenantId, tenantId),
        eq(bankStatementImports.accountId, accountId),
        eq(bankStatementImports.statementHash, hash),
      ),
    )
    .limit(1)
  const { fresh } = await planImport(db, tenantId, accountId, parsed.transactions)
  return {
    total: parsed.transactions.length,
    newLines: fresh.length,
    duplicateLines: parsed.transactions.length - fresh.length,
    suspects: fresh
      .filter((p) => p.suspectedDuplicateOf)
      .map((p) => ({
        index: p.index,
        date: p.date,
        amountCents: p.amountCents,
        memo: p.memo,
        suspectedDuplicateOf: p.suspectedDuplicateOf as string,
      })),
    alreadyImported: Boolean(already),
    warnings: accountWarnings(account, parsed),
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
  }
}

async function findBankAccount(tenantId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.tenantId, tenantId), eq(financialAccounts.id, accountId), isNull(financialAccounts.archivedAt)))
    .limit(1)
  if (!account) throw accountNotFound()
  if (account.kind !== 'bank') {
    throw new BusinessError('STATEMENT_ACCOUNT_NOT_BANK', 'O extrato só pode ser importado em uma conta bancária')
  }
  return account
}

export interface ImportResult {
  importId: string
  alreadyImported: boolean
  total: number
  newLines: number
  duplicateLines: number
  suspectLines: number
}

/**
 * Commits an import. The account row is locked for the whole transaction, so
 * two uploads of the same or overlapping statements run one after the other,
 * and a retry of the same file returns the first import instead of an error.
 */
export async function commitStatementImport(
  tenantId: string,
  userId: string,
  input: { accountId: string; fileName: string; parsed: ParsedOfx },
): Promise<ImportResult> {
  assertImportable(input.parsed)
  const { accountId, parsed } = input
  const hash = statementHash(parsed.transactions)

  return withTransaction(async (tx) => {
    await lockBankAccount(tx, tenantId, accountId)

    const [previous] = await tx
      .select()
      .from(bankStatementImports)
      .where(
        and(
          eq(bankStatementImports.tenantId, tenantId),
          eq(bankStatementImports.accountId, accountId),
          eq(bankStatementImports.statementHash, hash),
        ),
      )
      .limit(1)
    if (previous) {
      return {
        importId: previous.id,
        alreadyImported: true,
        total: previous.totalLines,
        newLines: previous.newLines,
        duplicateLines: previous.duplicateLines,
        suspectLines: previous.suspectLines,
      }
    }

    const { fresh } = await planImport(tx, tenantId, accountId, parsed.transactions)
    const suspectLines = fresh.filter((p) => p.suspectedDuplicateOf).length

    const [created] = await tx
      .insert(bankStatementImports)
      .values({
        tenantId,
        accountId,
        fileName: input.fileName.slice(0, 255),
        statementHash: hash,
        bankId: parsed.bankId?.slice(0, 30) ?? null,
        bankAccountId: parsed.accountId?.slice(0, 50) ?? null,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        totalLines: parsed.transactions.length,
        newLines: fresh.length,
        duplicateLines: parsed.transactions.length - fresh.length,
        suspectLines,
        importedBy: userId,
      })
      .returning({ id: bankStatementImports.id })

    let inserted = 0
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const rows = await tx
        .insert(bankStatementLines)
        .values(
          fresh.slice(i, i + CHUNK).map((p) => ({
            tenantId,
            accountId,
            importId: created.id,
            postedDate: p.date,
            amountCents: p.amountCents,
            fitid: p.fitid,
            memo: p.memo,
            trnType: p.type?.slice(0, 20) ?? null,
            checkNumber: p.checkNumber,
            identityKey: p.identityKey,
            occurrence: p.occurrence,
            fingerprint: p.fingerprint,
            suspectedDuplicateOf: p.suspectedDuplicateOf,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: bankStatementLines.id })
      inserted += rows.length
    }
    // Under the account lock nothing else can write these slots; a mismatch
    // means the plan is stale, so roll back instead of recording wrong counts.
    if (inserted !== fresh.length) {
      throw new BusinessError('STATEMENT_IMPORT_CONFLICT', 'O extrato foi alterado por outra importação. Tente novamente')
    }

    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'create',
        entityType: 'bank_statement_import',
        entityId: created.id,
        changes: {
          import: {
            old: null,
            new: { accountId, fileName: input.fileName, total: parsed.transactions.length, new: fresh.length, suspects: suspectLines },
          },
        },
      },
      tx,
    )

    return {
      importId: created.id,
      alreadyImported: false,
      total: parsed.transactions.length,
      newLines: fresh.length,
      duplicateLines: parsed.transactions.length - fresh.length,
      suspectLines,
    }
  })
}

export async function listStatementImports(tenantId: string, accountId: string) {
  return db
    .select()
    .from(bankStatementImports)
    .where(and(eq(bankStatementImports.tenantId, tenantId), eq(bankStatementImports.accountId, accountId)))
    .orderBy(desc(bankStatementImports.createdAt))
    .limit(50)
}

// ─── LINES ───────────────────────────────────────────────────────────

export type StatementLineStatus = 'open' | 'partial' | 'matched' | 'ignored'
export type StatementLineFilter = StatementLineStatus | 'pending' | 'all'

export interface StatementLineAllocation {
  id: string
  movementId: string
  amountCents: number
  description: string
  movementDate: Date
  createdAt: Date
}

export interface StatementLine {
  id: string
  accountId: string
  importId: string
  postedDate: string
  amountCents: number
  memo: string
  fitid: string | null
  trnType: string | null
  suspectedDuplicateOf: string | null
  suspectReviewedAt: Date | null
  ignoredAt: Date | null
  ignoreReason: string | null
  allocatedCents: number
  status: StatementLineStatus
  allocations: StatementLineAllocation[]
}

function lineStatus(amountCents: number, allocatedCents: number, ignored: boolean): StatementLineStatus {
  if (ignored) return 'ignored'
  if (allocatedCents === 0) return 'open'
  return allocatedCents >= Math.abs(amountCents) ? 'matched' : 'partial'
}

export async function listStatementLines(
  tenantId: string,
  opts: { accountId: string; status?: StatementLineFilter; limit?: number; offset?: number },
): Promise<{ lines: StatementLine[]; hasMore: boolean }> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const filter = opts.status ?? 'pending'

  const statusCondition = {
    all: undefined,
    ignored: sql`${bankStatementLines.ignoredAt} IS NOT NULL`,
    open: sql`${bankStatementLines.ignoredAt} IS NULL AND ${allocatedToLine} = 0`,
    partial: sql`${bankStatementLines.ignoredAt} IS NULL AND ${allocatedToLine} > 0 AND ${allocatedToLine} < abs(${bankStatementLines.amountCents})`,
    matched: sql`${bankStatementLines.ignoredAt} IS NULL AND ${allocatedToLine} >= abs(${bankStatementLines.amountCents})`,
    pending: sql`${bankStatementLines.ignoredAt} IS NULL AND ${allocatedToLine} < abs(${bankStatementLines.amountCents})`,
  }[filter]

  const rows = await db
    .select({
      id: bankStatementLines.id,
      accountId: bankStatementLines.accountId,
      importId: bankStatementLines.importId,
      postedDate: bankStatementLines.postedDate,
      amountCents: bankStatementLines.amountCents,
      memo: bankStatementLines.memo,
      fitid: bankStatementLines.fitid,
      trnType: bankStatementLines.trnType,
      suspectedDuplicateOf: bankStatementLines.suspectedDuplicateOf,
      suspectReviewedAt: bankStatementLines.suspectReviewedAt,
      ignoredAt: bankStatementLines.ignoredAt,
      ignoreReason: bankStatementLines.ignoreReason,
      allocated: allocatedToLine,
    })
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.tenantId, tenantId),
        eq(bankStatementLines.accountId, opts.accountId),
        statusCondition,
      ),
    )
    .orderBy(desc(bankStatementLines.postedDate), desc(bankStatementLines.createdAt), asc(bankStatementLines.id))
    .limit(limit + 1)
    .offset(opts.offset ?? 0)

  const page = rows.slice(0, limit)
  const ids = page.map((r) => r.id)
  const allocations = ids.length
    ? await db
        .select({
          id: bankReconciliationAllocations.id,
          lineId: bankReconciliationAllocations.lineId,
          movementId: bankReconciliationAllocations.movementId,
          amountCents: bankReconciliationAllocations.amountCents,
          createdAt: bankReconciliationAllocations.createdAt,
          description: cashMovements.description,
          movementDate: cashMovements.movementDate,
        })
        .from(bankReconciliationAllocations)
        .innerJoin(
          cashMovements,
          and(
            eq(cashMovements.tenantId, bankReconciliationAllocations.tenantId),
            eq(cashMovements.id, bankReconciliationAllocations.movementId),
          ),
        )
        .where(
          and(
            eq(bankReconciliationAllocations.tenantId, tenantId),
            inArray(bankReconciliationAllocations.lineId, ids),
            isNull(bankReconciliationAllocations.undoneAt),
          ),
        )
        .orderBy(asc(bankReconciliationAllocations.createdAt))
    : []

  return {
    hasMore: rows.length > limit,
    lines: page.map((r) => {
      const allocatedCents = Number(r.allocated)
      return {
        id: r.id,
        accountId: r.accountId,
        importId: r.importId,
        postedDate: r.postedDate,
        amountCents: r.amountCents,
        memo: r.memo,
        fitid: r.fitid,
        trnType: r.trnType,
        suspectedDuplicateOf: r.suspectedDuplicateOf,
        suspectReviewedAt: r.suspectReviewedAt,
        ignoredAt: r.ignoredAt,
        ignoreReason: r.ignoreReason,
        allocatedCents,
        status: lineStatus(r.amountCents, allocatedCents, Boolean(r.ignoredAt)),
        allocations: allocations
          .filter((a) => a.lineId === r.id)
          .map(({ lineId: _lineId, ...a }) => a),
      }
    }),
  }
}

// ─── CANDIDATES ──────────────────────────────────────────────────────

const movementCents = sql`round(${cashMovements.amount} * 100)::bigint`
const allocatedToMovement = sql`COALESCE((SELECT SUM(a.amount_cents) FROM floraclin.bank_reconciliation_allocations a WHERE a.tenant_id = "cash_movements"."tenant_id" AND a.movement_id = "cash_movements"."id" AND a.undone_at IS NULL), 0)`

/**
 * A movement that is half of a bookkeeping correction: a payment that was
 * reversed and its counter-entry, on the same account for the same amount,
 * with neither half reconciled. Together they net to zero, so they are kept
 * out of the default queue. Once either half is allocated, or if the pair is
 * not a clean same-account net-zero one, nothing is hidden. A real bank refund
 * can still be matched by showing the hidden ones.
 */
const isBookkeepingPair = sql`EXISTS (
  SELECT 1 FROM floraclin.cash_movements p
  WHERE p.tenant_id = "cash_movements"."tenant_id"
    AND p.account_id = "cash_movements"."account_id"
    AND p.amount = "cash_movements"."amount"
    AND p.type <> "cash_movements"."type"
    AND (p.reversed_by_movement_id = "cash_movements"."id" OR "cash_movements"."reversed_by_movement_id" = p.id)
    AND NOT EXISTS (
      SELECT 1 FROM floraclin.bank_reconciliation_allocations a
      WHERE a.tenant_id = "cash_movements"."tenant_id" AND a.undone_at IS NULL
        AND a.movement_id IN ("cash_movements"."id", p.id)
    )
)`

export interface MatchCandidate {
  id: string
  description: string
  type: string
  amount: string
  paymentMethod: string | null
  movementDate: Date
  remainingCents: number
  dayDistance: number
  bookkeepingPair: boolean
}

/** Ledger movements on the line's account that can still take part of the line, closest first. */
export async function findMatchCandidates(
  tenantId: string,
  lineId: string,
  opts: { search?: string; includeBookkeepingPairs?: boolean; windowDays?: number } = {},
): Promise<MatchCandidate[]> {
  const [line] = await db
    .select({
      accountId: bankStatementLines.accountId,
      postedDate: bankStatementLines.postedDate,
      amountCents: bankStatementLines.amountCents,
      allocated: allocatedToLine,
    })
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)))
    .limit(1)
  if (!line) throw lineNotFound()

  const lineRemaining = Math.abs(line.amountCents) - Number(line.allocated)
  const direction = line.amountCents > 0 ? 'inflow' : 'outflow'
  const dayDistance = sql<number>`abs((${cashMovements.movementDate} AT TIME ZONE 'America/Sao_Paulo')::date - ${line.postedDate}::date)`
  const search = opts.search?.trim()

  const rows = await db
    .select({
      id: cashMovements.id,
      description: cashMovements.description,
      type: cashMovements.type,
      amount: cashMovements.amount,
      paymentMethod: cashMovements.paymentMethod,
      movementDate: cashMovements.movementDate,
      remaining: sql<string>`${movementCents} - ${allocatedToMovement}`,
      dayDistance,
      bookkeepingPair: isBookkeepingPair,
    })
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.tenantId, tenantId),
        eq(cashMovements.accountId, line.accountId),
        eq(cashMovements.type, direction),
        sql`${movementCents} - ${allocatedToMovement} > 0`,
        search
          ? sql`${cashMovements.description} ILIKE ${'%' + search.replace(/[\\%_]/g, '\\$&') + '%'}`
          : sql`${dayDistance} <= ${opts.windowDays ?? 45}`,
        opts.includeBookkeepingPairs ? undefined : sql`NOT ${isBookkeepingPair}`,
      ),
    )
    .orderBy(
      sql`CASE WHEN ${movementCents} - ${allocatedToMovement} = ${lineRemaining} THEN 0 ELSE 1 END`,
      dayDistance,
      desc(cashMovements.movementDate),
      asc(cashMovements.id),
    )
    .limit(50)

  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    type: r.type,
    amount: r.amount,
    paymentMethod: r.paymentMethod,
    movementDate: r.movementDate,
    remainingCents: Number(r.remaining),
    dayDistance: Number(r.dayDistance),
    bookkeepingPair: Boolean(r.bookkeepingPair),
  }))
}

// ─── ALLOCATIONS ─────────────────────────────────────────────────────

export interface AllocationInput {
  movementId: string
  amountCents: number
}

async function lockLine(tx: Tx, tenantId: string, lineId: string) {
  const [line] = await tx
    .select()
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)))
    .for('update')
  if (!line) throw lineNotFound()
  return line
}

async function activeAllocatedToLine(tx: Tx, tenantId: string, lineId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`COALESCE(SUM(${bankReconciliationAllocations.amountCents}), 0)` })
    .from(bankReconciliationAllocations)
    .where(
      and(
        eq(bankReconciliationAllocations.tenantId, tenantId),
        eq(bankReconciliationAllocations.lineId, lineId),
        isNull(bankReconciliationAllocations.undoneAt),
      ),
    )
  return Number(row?.total ?? 0)
}

/**
 * Links a statement line to one or more ledger movements with explicit cents.
 * One bank credit can cover several card repasses; several credits can cover
 * one movement. Nothing is ever over-allocated on either side (checked here
 * for a clear message and again by the database trigger). Matching never
 * changes an installment, a payment or a movement.
 */
export async function allocateStatementLine(
  tenantId: string,
  userId: string,
  lineId: string,
  items: readonly AllocationInput[],
) {
  if (items.length === 0) throw new BusinessError('ALLOCATION_EMPTY', 'Escolha ao menos uma movimentação')
  const ids = items.map((i) => i.movementId)
  if (new Set(ids).size !== ids.length) {
    throw new BusinessError('ALLOCATION_DUPLICATE', 'A mesma movimentação foi escolhida mais de uma vez')
  }
  if (items.some((i) => !Number.isSafeInteger(i.amountCents) || i.amountCents <= 0)) {
    throw new BusinessError('ALLOCATION_AMOUNT', 'Informe valores positivos para a conciliação')
  }

  return withTransaction(async (tx) => {
    const line = await lockLine(tx, tenantId, lineId)
    if (line.ignoredAt) throw new BusinessError('STATEMENT_LINE_IGNORED', 'Lançamento ignorado: desfaça o ignorar para conciliar')

    const movements = await tx
      .select()
      .from(cashMovements)
      .where(and(eq(cashMovements.tenantId, tenantId), inArray(cashMovements.id, ids)))
      .orderBy(asc(cashMovements.id))
      .for('update')
    if (movements.length !== ids.length) {
      throw new BusinessError('MOVEMENT_NOT_FOUND', 'Movimentação não encontrada')
    }

    const used = await tx
      .select({
        movementId: bankReconciliationAllocations.movementId,
        total: sql<string>`SUM(${bankReconciliationAllocations.amountCents})`,
      })
      .from(bankReconciliationAllocations)
      .where(
        and(
          eq(bankReconciliationAllocations.tenantId, tenantId),
          inArray(bankReconciliationAllocations.movementId, ids),
          isNull(bankReconciliationAllocations.undoneAt),
        ),
      )
      .groupBy(bankReconciliationAllocations.movementId)
    const usedByMovement = new Map(used.map((u) => [u.movementId, Number(u.total)]))

    const wantInflow = line.amountCents > 0
    for (const item of items) {
      const movement = movements.find((m) => m.id === item.movementId)!
      if (movement.accountId !== line.accountId) {
        throw new BusinessError('ALLOCATION_ACCOUNT', 'A movimentação é de outra conta')
      }
      if ((movement.type === 'inflow') !== wantInflow) {
        throw new BusinessError('ALLOCATION_DIRECTION', wantInflow ? 'Um crédito só concilia com entradas' : 'Um débito só concilia com saídas')
      }
      const remaining = Math.round(Number(movement.amount) * 100) - (usedByMovement.get(movement.id) ?? 0)
      if (item.amountCents > remaining) {
        throw new BusinessError('ALLOCATION_OVER_MOVEMENT', 'O valor é maior que o saldo disponível da movimentação')
      }
    }

    const lineRemaining = Math.abs(line.amountCents) - (await activeAllocatedToLine(tx, tenantId, lineId))
    const total = items.reduce((sum, i) => sum + i.amountCents, 0)
    if (total > lineRemaining) {
      throw new BusinessError('ALLOCATION_OVER_LINE', 'O total é maior que o saldo disponível do lançamento')
    }

    let created
    try {
      created = await tx
        .insert(bankReconciliationAllocations)
        .values(
          items.map((item) => ({
            tenantId,
            accountId: line.accountId,
            lineId,
            movementId: item.movementId,
            amountCents: item.amountCents,
            createdBy: userId,
          })),
        )
        .returning({ id: bankReconciliationAllocations.id, movementId: bankReconciliationAllocations.movementId })
    } catch (error) {
      asAllocationConflict(error)
    }

    for (const row of created) {
      const item = items.find((i) => i.movementId === row.movementId)!
      await createAuditLog(
        {
          tenantId,
          userId,
          action: 'create',
          entityType: 'bank_reconciliation_allocation',
          entityId: row.id,
          changes: { allocation: { old: null, new: { lineId, movementId: row.movementId, amountCents: item.amountCents } } },
        },
        tx,
      )
    }
    return { allocationIds: created.map((c) => c.id) }
  })
}

/**
 * Undoes a match: the allocations are marked undone (kept for the audit trail)
 * and the line goes back to open. The payment, the movement and any installment
 * stay exactly as they were.
 */
export async function undoStatementLineMatch(
  tenantId: string,
  userId: string,
  target: { lineId: string; allocationId?: string },
) {
  return withTransaction(async (tx) => {
    await lockLine(tx, tenantId, target.lineId)
    const now = new Date()
    const undone = await tx
      .update(bankReconciliationAllocations)
      .set({ undoneAt: now, undoneBy: userId })
      .where(
        and(
          eq(bankReconciliationAllocations.tenantId, tenantId),
          eq(bankReconciliationAllocations.lineId, target.lineId),
          isNull(bankReconciliationAllocations.undoneAt),
          target.allocationId ? eq(bankReconciliationAllocations.id, target.allocationId) : undefined,
        ),
      )
      .returning({ id: bankReconciliationAllocations.id, movementId: bankReconciliationAllocations.movementId, amountCents: bankReconciliationAllocations.amountCents })
    if (undone.length === 0) {
      throw new BusinessError('ALLOCATION_NOT_FOUND', 'Nenhuma conciliação ativa para desfazer')
    }
    for (const row of undone) {
      await createAuditLog(
        {
          tenantId,
          userId,
          action: 'delete',
          entityType: 'bank_reconciliation_allocation',
          entityId: row.id,
          changes: { allocation: { old: { lineId: target.lineId, movementId: row.movementId, amountCents: row.amountCents }, new: null } },
        },
        tx,
      )
    }
    return { undone: undone.length }
  })
}

// ─── IGNORE / REVIEW ─────────────────────────────────────────────────

export async function ignoreStatementLine(tenantId: string, userId: string, lineId: string, reason: string) {
  const trimmed = reason.trim()
  if (!trimmed) throw new BusinessError('IGNORE_REASON_REQUIRED', 'Informe o motivo para ignorar o lançamento')
  return withTransaction(async (tx) => {
    const line = await lockLine(tx, tenantId, lineId)
    if (line.ignoredAt) return line
    if ((await activeAllocatedToLine(tx, tenantId, lineId)) > 0) {
      throw new BusinessError('STATEMENT_LINE_ALLOCATED', 'Desfaça a conciliação antes de ignorar o lançamento')
    }
    const [updated] = await tx
      .update(bankStatementLines)
      .set({ ignoredAt: new Date(), ignoredBy: userId, ignoreReason: trimmed.slice(0, 255) })
      .where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)))
      .returning()
    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'bank_statement_line',
        entityId: lineId,
        changes: { ignored: { old: false, new: true }, reason: { old: null, new: updated.ignoreReason } },
      },
      tx,
    )
    return updated
  })
}

export async function unignoreStatementLine(tenantId: string, userId: string, lineId: string) {
  return withTransaction(async (tx) => {
    const line = await lockLine(tx, tenantId, lineId)
    if (!line.ignoredAt) return line
    const [updated] = await tx
      .update(bankStatementLines)
      .set({ ignoredAt: null, ignoredBy: null, ignoreReason: null })
      .where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)))
      .returning()
    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'bank_statement_line',
        entityId: lineId,
        changes: { ignored: { old: true, new: false }, reason: { old: line.ignoreReason, new: null } },
      },
      tx,
    )
    return updated
  })
}

/** The user looked at a suspected duplicate and decided it is a genuine, separate transaction. */
export async function confirmSuspectedLineIsDistinct(tenantId: string, userId: string, lineId: string) {
  return withTransaction(async (tx) => {
    const line = await lockLine(tx, tenantId, lineId)
    if (!line.suspectedDuplicateOf || line.suspectReviewedAt) return line
    const [updated] = await tx
      .update(bankStatementLines)
      .set({ suspectReviewedAt: new Date(), suspectReviewedBy: userId })
      .where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)))
      .returning()
    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'bank_statement_line',
        entityId: lineId,
        changes: { suspectReviewed: { old: false, new: true } },
      },
      tx,
    )
    return updated
  })
}

// ─── CREATE FROM LINE ────────────────────────────────────────────────

export interface CreateFeeFromLineInput {
  categoryId: string
  description?: string
  paymentMethod: 'pix' | 'transfer' | 'debit_card' | 'cash' | 'credit_card'
}

/**
 * A bank debit with no ledger entry (a fee, a bill paid straight from the
 * bank): records it as a normal paid expense through the usual expense paths,
 * on the line's account, and links the whole line to the resulting outflow. It
 * all happens in one transaction, and the line lock plus the allocation limit
 * make a double click or a second user create it only once.
 */
export async function createExpenseFromStatementLine(
  tenantId: string,
  userId: string,
  lineId: string,
  input: CreateFeeFromLineInput,
) {
  return withTransaction(async (tx) => {
    const line = await lockLine(tx, tenantId, lineId)
    if (line.ignoredAt) throw new BusinessError('STATEMENT_LINE_IGNORED', 'Lançamento ignorado: desfaça o ignorar para conciliar')
    if (line.amountCents > 0) {
      throw new BusinessError('STATEMENT_LINE_NOT_DEBIT', 'Só é possível criar uma despesa a partir de um débito. Para créditos, registre o pagamento da parcela')
    }
    if ((await activeAllocatedToLine(tx, tenantId, lineId)) > 0) {
      throw new BusinessError('STATEMENT_LINE_ALLOCATED', 'Este lançamento já está conciliado')
    }
    const [account] = await tx
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(and(eq(financialAccounts.tenantId, tenantId), eq(financialAccounts.id, line.accountId), isNull(financialAccounts.archivedAt)))
      .limit(1)
    if (!account) throw accountNotFound()

    const amountCents = Math.abs(line.amountCents)
    const expense = await createExpense(
      tenantId,
      userId,
      {
        categoryId: input.categoryId,
        description: (input.description?.trim() || line.memo).slice(0, 255),
        totalAmount: amountCents / 100,
        installmentCount: 1,
        notes: 'Criada a partir do extrato bancário',
        customDueDates: [line.postedDate],
      },
      tx,
    )
    const [installment] = await tx
      .select({ id: expenseInstallments.id })
      .from(expenseInstallments)
      .where(eq(expenseInstallments.expenseId, expense.id))
    await payExpenseInstallment(
      tenantId,
      installment.id,
      input.paymentMethod,
      userId,
      parseBrDate(line.postedDate, '12:00:00').toISOString(),
      line.accountId,
      tx,
    )
    const [movement] = await tx
      .select({ id: cashMovements.id })
      .from(cashMovements)
      .where(and(eq(cashMovements.tenantId, tenantId), eq(cashMovements.expenseInstallmentId, installment.id), eq(cashMovements.type, 'outflow')))
      .orderBy(desc(cashMovements.recordedAt))
      .limit(1)

    let allocation
    try {
      ;[allocation] = await tx
        .insert(bankReconciliationAllocations)
        .values({ tenantId, accountId: line.accountId, lineId, movementId: movement.id, amountCents, createdBy: userId })
        .returning({ id: bankReconciliationAllocations.id })
    } catch (error) {
      asAllocationConflict(error)
    }
    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'create',
        entityType: 'bank_reconciliation_allocation',
        entityId: allocation.id,
        changes: { allocation: { old: null, new: { lineId, movementId: movement.id, amountCents, createdFrom: 'statement_line' } } },
      },
      tx,
    )
    return { expenseId: expense.id, movementId: movement.id, allocationId: allocation.id }
  })
}
