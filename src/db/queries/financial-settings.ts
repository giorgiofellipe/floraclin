import { db } from '@/db/client'
import { financialSettings, expenseCategories } from '@/db/schema'
import { eq, and, or, isNull, asc } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import type { UpdateFinancialSettingsInput } from '@/validations/financial-settings'
import type { ExpenseCategoryInput } from '@/validations/expenses'

export async function getFinancialSettings(tenantId: string) {
  const [existing] = await db
    .select()
    .from(financialSettings)
    .where(eq(financialSettings.tenantId, tenantId))
    .limit(1)

  if (existing) return existing

  // Create with defaults (upsert pattern)
  const [created] = await db
    .insert(financialSettings)
    .values({ tenantId })
    .onConflictDoNothing()
    .returning()

  // If concurrent insert won, re-fetch
  if (!created) {
    const [refetched] = await db
      .select()
      .from(financialSettings)
      .where(eq(financialSettings.tenantId, tenantId))
      .limit(1)
    return refetched
  }

  return created
}

export async function updateFinancialSettings(
  tenantId: string,
  userId: string,
  data: UpdateFinancialSettingsInput
) {
  return withTransaction(async (tx) => {
    // Ensure settings row exists
    const [existing] = await tx
      .select({ id: financialSettings.id })
      .from(financialSettings)
      .where(eq(financialSettings.tenantId, tenantId))
      .limit(1)

    let result
    if (existing) {
      const [updated] = await tx
        .update(financialSettings)
        .set({
          ...data,
          fineValue: data.fineValue?.toFixed(2),
          monthlyInterestPercent: data.monthlyInterestPercent?.toFixed(2),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(financialSettings.tenantId, tenantId))
        .returning()
      result = updated
    } else {
      const [created] = await tx
        .insert(financialSettings)
        .values({
          tenantId,
          ...data,
          fineValue: data.fineValue?.toFixed(2) ?? '2.00',
          monthlyInterestPercent: data.monthlyInterestPercent?.toFixed(2) ?? '1.00',
          updatedBy: userId,
        })
        .returning()
      result = created
    }

    await createAuditLog({
      tenantId,
      userId,
      action: 'update',
      entityType: 'financial_settings',
      entityId: result.id,
    }, tx)

    return result
  })
}

export async function getExpenseCategories(tenantId: string) {
  return db
    .select()
    .from(expenseCategories)
    .where(
      and(
        or(
          isNull(expenseCategories.tenantId),
          eq(expenseCategories.tenantId, tenantId)
        ),
        isNull(expenseCategories.deletedAt)
      )
    )
    .orderBy(asc(expenseCategories.sortOrder))
}

export async function createExpenseCategory(
  tenantId: string,
  userId: string,
  data: ExpenseCategoryInput
) {
  return withTransaction(async (tx) => {
    const [category] = await tx
      .insert(expenseCategories)
      .values({
        tenantId,
        name: data.name,
        icon: data.icon,
        isSystem: false,
        sortOrder: 999, // append at end
      })
      .returning()

    await createAuditLog({
      tenantId,
      userId,
      action: 'create',
      entityType: 'expense_category',
      entityId: category.id,
    }, tx)

    return category
  })
}

export async function updateExpenseCategory(
  tenantId: string,
  userId: string,
  categoryId: string,
  data: ExpenseCategoryInput
) {
  return withTransaction(async (tx) => {
    // Only allow updating non-system categories owned by this tenant
    const [category] = await tx
      .select()
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.id, categoryId),
          eq(expenseCategories.tenantId, tenantId),
          eq(expenseCategories.isSystem, false),
          isNull(expenseCategories.deletedAt)
        )
      )
      .limit(1)

    if (!category) {
      throw new Error('Categoria não encontrada ou não pode ser editada')
    }

    const [updated] = await tx
      .update(expenseCategories)
      .set({
        name: data.name,
        icon: data.icon,
      })
      .where(eq(expenseCategories.id, categoryId))
      .returning()

    await createAuditLog({
      tenantId,
      userId,
      action: 'update',
      entityType: 'expense_category',
      entityId: categoryId,
    }, tx)

    return updated
  })
}

export async function deleteExpenseCategory(
  tenantId: string,
  userId: string,
  categoryId: string
) {
  return withTransaction(async (tx) => {
    // Only allow deleting non-system categories owned by this tenant
    const [category] = await tx
      .select()
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.id, categoryId),
          eq(expenseCategories.tenantId, tenantId),
          eq(expenseCategories.isSystem, false),
          isNull(expenseCategories.deletedAt)
        )
      )
      .limit(1)

    if (!category) {
      throw new Error('Categoria não encontrada ou não pode ser excluída')
    }

    const [deleted] = await tx
      .update(expenseCategories)
      .set({ deletedAt: new Date() })
      .where(eq(expenseCategories.id, categoryId))
      .returning()

    await createAuditLog({
      tenantId,
      userId,
      action: 'delete',
      entityType: 'expense_category',
      entityId: categoryId,
    }, tx)

    return deleted
  })
}

export async function reorderExpenseCategories(
  tenantId: string,
  userId: string,
  orderedIds: string[]
) {
  return withTransaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(expenseCategories)
        .set({ sortOrder: i })
        .where(
          and(
            eq(expenseCategories.id, orderedIds[i]),
            or(
              isNull(expenseCategories.tenantId),
              eq(expenseCategories.tenantId, tenantId)
            )
          )
        )
    }

    await createAuditLog({
      tenantId,
      userId,
      action: 'update',
      entityType: 'expense_category',
      entityId: orderedIds[0],
      changes: { sortOrder: { old: null, new: orderedIds } },
    }, tx)
  })
}
