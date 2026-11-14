import { db } from '@/db/client'
import { cardTerminals, financialAccounts } from '@/db/schema'
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import { BusinessError } from '@/lib/errors'
import type { CardTerminalInput } from '@/validations/card-terminals'

export type CardTerminalRow = typeof cardTerminals.$inferSelect

const notFound = () => new BusinessError('CARD_TERMINAL_NOT_FOUND', 'Maquininha não encontrada')

const activeInTenant = (tenantId: string) =>
  and(eq(cardTerminals.tenantId, tenantId), isNull(cardTerminals.deletedAt))

function toColumns(data: CardTerminalInput) {
  return {
    name: data.name,
    isDefault: data.isDefault,
    debitRate: data.debitRate?.toFixed(2) ?? null,
    debitPayoutDays: data.debitPayoutDays,
    creditRates: data.creditRates.map((rate) => rate?.toFixed(2) ?? null),
    creditPayoutMode: data.creditPayoutMode,
    creditLumpSumDays: data.creditLumpSumDays,
    payoutAccountId: data.payoutAccountId ?? null,
  }
}

// The (tenant_id, payout_account_id) foreign key already refuses another
// clinic's account; this turns that into a 404 and keeps cash drawers and
// archived accounts out of a payout.
async function assertPayoutAccount(tx: typeof db, tenantId: string, accountId: string | null | undefined) {
  if (!accountId) return
  const [account] = await tx
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(
      and(
        eq(financialAccounts.tenantId, tenantId),
        eq(financialAccounts.id, accountId),
        isNull(financialAccounts.archivedAt),
        inArray(financialAccounts.kind, ['bank', 'acquirer']),
      ),
    )
    .limit(1)
  if (!account) {
    throw new BusinessError('FINANCIAL_ACCOUNT_NOT_FOUND', 'Conta de recebimento não encontrada ou arquivada')
  }
}

export async function listCardTerminals(tenantId: string): Promise<CardTerminalRow[]> {
  return db
    .select()
    .from(cardTerminals)
    .where(activeInTenant(tenantId))
    .orderBy(desc(cardTerminals.isDefault), asc(cardTerminals.name))
}

export async function createCardTerminal(
  tenantId: string,
  userId: string,
  data: CardTerminalInput,
) {
  return withTransaction(async (tx) => {
    await assertPayoutAccount(tx, tenantId, data.payoutAccountId)

    const [{ value: existing }] = await tx
      .select({ value: count() })
      .from(cardTerminals)
      .where(activeInTenant(tenantId))

    const isDefault = data.isDefault || existing === 0
    if (isDefault) {
      await tx
        .update(cardTerminals)
        .set({ isDefault: false })
        .where(and(activeInTenant(tenantId), eq(cardTerminals.isDefault, true)))
    }

    const [terminal] = await tx
      .insert(cardTerminals)
      .values({ tenantId, ...toColumns(data), isDefault })
      .returning()

    await createAuditLog(
      { tenantId, userId, action: 'create', entityType: 'card_terminal', entityId: terminal.id },
      tx,
    )

    return terminal
  })
}

export async function updateCardTerminal(
  tenantId: string,
  userId: string,
  id: string,
  data: CardTerminalInput,
) {
  return withTransaction(async (tx) => {
    const [current] = await tx
      .select({ id: cardTerminals.id })
      .from(cardTerminals)
      .where(and(activeInTenant(tenantId), eq(cardTerminals.id, id)))
      .limit(1)
    if (!current) throw notFound()
    await assertPayoutAccount(tx, tenantId, data.payoutAccountId)

    if (data.isDefault) {
      await tx
        .update(cardTerminals)
        .set({ isDefault: false })
        .where(and(activeInTenant(tenantId), eq(cardTerminals.isDefault, true)))
    }

    const [terminal] = await tx
      .update(cardTerminals)
      .set({ ...toColumns(data), updatedAt: new Date() })
      .where(and(activeInTenant(tenantId), eq(cardTerminals.id, id)))
      .returning()

    await createAuditLog(
      { tenantId, userId, action: 'update', entityType: 'card_terminal', entityId: id },
      tx,
    )

    return terminal
  })
}

export async function deleteCardTerminal(tenantId: string, userId: string, id: string) {
  return withTransaction(async (tx) => {
    const [current] = await tx
      .select({ id: cardTerminals.id })
      .from(cardTerminals)
      .where(and(activeInTenant(tenantId), eq(cardTerminals.id, id)))
      .limit(1)
    if (!current) throw notFound()

    await tx
      .update(cardTerminals)
      .set({ deletedAt: new Date(), isDefault: false })
      .where(and(activeInTenant(tenantId), eq(cardTerminals.id, id)))

    await createAuditLog(
      { tenantId, userId, action: 'delete', entityType: 'card_terminal', entityId: id },
      tx,
    )
  })
}
