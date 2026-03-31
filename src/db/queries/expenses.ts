import { db } from '@/db/client'
import {
  expenses,
  expenseInstallments,
  expenseCategories,
  expenseAttachments,
  cashMovements,
} from '@/db/schema'
import { eq, and, isNull, sql, gte, lte, count, desc } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import { addDays } from 'date-fns'
import { verifyTenantOwnership } from './helpers'
import type { CreateExpenseInput, ExpenseFilterInput } from '@/validations/expenses'
import type { PaymentMethod } from '@/types'

export async function createExpense(
  tenantId: string,
  userId: string,
  data: CreateExpenseInput
) {
  // Verify category belongs to this tenant or is a system default
  const [category] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.id, data.categoryId),
        isNull(expenseCategories.deletedAt),
        sql`(${expenseCategories.tenantId} = ${tenantId} OR ${expenseCategories.tenantId} IS NULL)`
      )
    )
    .limit(1)

  if (!category) {
    throw new Error('Categoria não encontrada ou não pertence a esta clínica')
  }

  return withTransaction(async (tx) => {
    const [expense] = await tx
      .insert(expenses)
      .values({
        tenantId,
        categoryId: data.categoryId,
        description: data.description,
        totalAmount: data.totalAmount.toFixed(2),
        installmentCount: data.installmentCount,
        status: 'pending',
        notes: data.notes,
        createdBy: userId,
      })
      .returning()

    // Generate installments — same logic as charges
    const installmentAmount = Math.floor((data.totalAmount * 100) / data.installmentCount) / 100
    const remainder = Math.round((data.totalAmount - installmentAmount * data.installmentCount) * 100) / 100
    const today = new Date()

    const installmentRows = Array.from({ length: data.installmentCount }, (_, i) => {
      const amount = i === 0 ? installmentAmount + remainder : installmentAmount
      const dueDate =
        data.customDueDates && data.customDueDates[i]
          ? data.customDueDates[i]
          : addDays(today, i * 30).toISOString().split('T')[0]
      return {
        expenseId: expense.id,
        installmentNumber: i + 1,
        amount: amount.toFixed(2),
        dueDate,
        status: 'pending' as const,
      }
    })

    await tx.insert(expenseInstallments).values(installmentRows)

    await createAuditLog({
      tenantId,
      userId,
      action: 'create',
      entityType: 'expense',
      entityId: expense.id,
    }, tx)

    return expense
  })
}

export async function listExpenses(
  tenantId: string,
  filters: ExpenseFilterInput
) {
  const conditions = [
    eq(expenses.tenantId, tenantId),
    isNull(expenses.deletedAt),
  ]

  if (filters.status) {
    conditions.push(eq(expenses.status, filters.status))
  }

  if (filters.categoryId) {
    conditions.push(eq(expenses.categoryId, filters.categoryId))
  }

  if (filters.dateFrom) {
    conditions.push(gte(expenses.createdAt, new Date(filters.dateFrom)))
  }

  if (filters.dateTo) {
    conditions.push(lte(expenses.createdAt, new Date(filters.dateTo)))
  }

  const offset = ((filters.page ?? 1) - 1) * (filters.limit ?? 20)

  const [totalResult, entries] = await Promise.all([
    db
      .select({ count: count() })
      .from(expenses)
      .where(and(...conditions)),
    db
      .select({
        id: expenses.id,
        categoryId: expenses.categoryId,
        categoryName: expenseCategories.name,
        categoryIcon: expenseCategories.icon,
        description: expenses.description,
        totalAmount: expenses.totalAmount,
        installmentCount: expenses.installmentCount,
        status: expenses.status,
        notes: expenses.notes,
        createdAt: expenses.createdAt,
        paidInstallments: sql<number>`(
          SELECT COUNT(*)::int FROM floraclin.expense_installments ei
          WHERE ei.expense_id = ${expenses.id}
          AND ei.status = 'paid'
        )`,
        isOverdue: sql<boolean>`EXISTS (
          SELECT 1 FROM floraclin.expense_installments ei
          WHERE ei.expense_id = ${expenses.id}
          AND ei.status = 'pending'
          AND ei.due_date < CURRENT_DATE
        )`,
      })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(and(...conditions))
      .orderBy(desc(expenses.createdAt))
      .limit(filters.limit ?? 20)
      .offset(offset),
  ])

  const total = totalResult[0]?.count ?? 0
  const limit = filters.limit ?? 20

  return {
    data: entries,
    total,
    page: filters.page ?? 1,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

export async function getExpense(tenantId: string, expenseId: string) {
  const [expense] = await db
    .select({
      id: expenses.id,
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      categoryIcon: expenseCategories.icon,
      description: expenses.description,
      totalAmount: expenses.totalAmount,
      installmentCount: expenses.installmentCount,
      status: expenses.status,
      notes: expenses.notes,
      createdBy: expenses.createdBy,
      createdAt: expenses.createdAt,
      updatedAt: expenses.updatedAt,
    })
    .from(expenses)
    .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(
      and(
        eq(expenses.tenantId, tenantId),
        eq(expenses.id, expenseId),
        isNull(expenses.deletedAt)
      )
    )
    .limit(1)

  if (!expense) return null

  const [installmentRows, attachmentRows] = await Promise.all([
    db
      .select()
      .from(expenseInstallments)
      .where(eq(expenseInstallments.expenseId, expenseId))
      .orderBy(expenseInstallments.installmentNumber),
    db
      .select()
      .from(expenseAttachments)
      .where(eq(expenseAttachments.expenseId, expenseId))
      .orderBy(desc(expenseAttachments.createdAt)),
  ])

  return {
    ...expense,
    installments: installmentRows,
    attachments: attachmentRows,
  }
}

export async function payExpenseInstallment(
  tenantId: string,
  installmentId: string,
  paymentMethod: PaymentMethod,
  userId: string,
  paidAt?: string
) {
  return withTransaction(async (tx) => {
    // Fetch installment and verify tenant ownership through parent expense
    const [installment] = await tx
      .select({
        id: expenseInstallments.id,
        expenseId: expenseInstallments.expenseId,
        amount: expenseInstallments.amount,
        status: expenseInstallments.status,
        installmentNumber: expenseInstallments.installmentNumber,
        categoryId: expenses.categoryId,
      })
      .from(expenseInstallments)
      .innerJoin(expenses, eq(expenses.id, expenseInstallments.expenseId))
      .where(
        and(
          eq(expenseInstallments.id, installmentId),
          eq(expenses.tenantId, tenantId),
          isNull(expenses.deletedAt)
        )
      )
      .limit(1)

    if (!installment) {
      throw new Error('Parcela não encontrada ou não pertence a esta clínica')
    }

    if (installment.status === 'paid') {
      throw new Error('Parcela já foi paga')
    }

    const now = paidAt ? new Date(paidAt) : new Date()

    // Mark installment as paid
    const [updated] = await tx
      .update(expenseInstallments)
      .set({
        status: 'paid',
        paidAt: now,
        paymentMethod,
      })
      .where(eq(expenseInstallments.id, installmentId))
      .returning()

    // Create cash_movements outflow in same transaction
    await tx.insert(cashMovements).values({
      tenantId,
      type: 'outflow',
      amount: installment.amount,
      description: `Despesa parcela ${installment.installmentNumber}`,
      paymentMethod,
      movementDate: now,
      expenseInstallmentId: installmentId,
      expenseCategoryId: installment.categoryId,
      recordedBy: userId,
    })

    // Check if all installments are now paid -> update parent expense status
    const allInstallments = await tx
      .select({ status: expenseInstallments.status })
      .from(expenseInstallments)
      .where(eq(expenseInstallments.expenseId, installment.expenseId))

    const allPaid = allInstallments.every((i) => i.status === 'paid')

    if (allPaid) {
      await tx
        .update(expenses)
        .set({
          status: 'paid',
          updatedAt: new Date(),
        })
        .where(eq(expenses.id, installment.expenseId))
    }

    await createAuditLog({
      tenantId,
      userId,
      action: 'update',
      entityType: 'expense_installment',
      entityId: installmentId,
      changes: {
        status: { old: 'pending', new: 'paid' },
        paymentMethod: { old: null, new: paymentMethod },
      },
    }, tx)

    return updated
  })
}

export async function cancelExpense(
  tenantId: string,
  expenseId: string,
  userId: string
) {
  return withTransaction(async (tx) => {
    // Verify expense belongs to tenant
    const [expense] = await tx
      .select({ id: expenses.id, status: expenses.status })
      .from(expenses)
      .where(
        and(
          eq(expenses.tenantId, tenantId),
          eq(expenses.id, expenseId),
          isNull(expenses.deletedAt)
        )
      )
      .limit(1)

    if (!expense) {
      throw new Error('Despesa não encontrada')
    }

    if (expense.status === 'cancelled') {
      throw new Error('Despesa já está cancelada')
    }

    // Set expense status to cancelled
    await tx
      .update(expenses)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, expenseId))

    // Cancel all unpaid installments (preserve paid ones)
    await tx
      .update(expenseInstallments)
      .set({ status: 'cancelled' as any })
      .where(
        and(
          eq(expenseInstallments.expenseId, expenseId),
          eq(expenseInstallments.status, 'pending')
        )
      )

    await createAuditLog({
      tenantId,
      userId,
      action: 'update',
      entityType: 'expense',
      entityId: expenseId,
      changes: {
        status: { old: expense.status, new: 'cancelled' },
      },
    }, tx)

    return { success: true }
  })
}

export async function addExpenseAttachment(
  tenantId: string,
  expenseId: string,
  fileData: {
    fileName: string
    fileUrl: string
    fileSize: number
    mimeType: string
  },
  userId: string
) {
  // Verify expense belongs to tenant
  await verifyTenantOwnership(tenantId, expenses, expenseId, 'Expense')

  const [attachment] = await db
    .insert(expenseAttachments)
    .values({
      expenseId,
      fileName: fileData.fileName,
      fileUrl: fileData.fileUrl,
      fileSize: fileData.fileSize,
      mimeType: fileData.mimeType,
      uploadedBy: userId,
    })
    .returning()

  return attachment
}

export async function deleteExpenseAttachment(
  tenantId: string,
  attachmentId: string,
  userId: string
) {
  // Fetch attachment and verify tenant ownership through parent expense
  const [attachment] = await db
    .select({
      id: expenseAttachments.id,
      expenseId: expenseAttachments.expenseId,
      fileUrl: expenseAttachments.fileUrl,
    })
    .from(expenseAttachments)
    .innerJoin(expenses, eq(expenses.id, expenseAttachments.expenseId))
    .where(
      and(
        eq(expenseAttachments.id, attachmentId),
        eq(expenses.tenantId, tenantId),
        isNull(expenses.deletedAt)
      )
    )
    .limit(1)

  if (!attachment) {
    throw new Error('Anexo não encontrado')
  }

  await db
    .delete(expenseAttachments)
    .where(eq(expenseAttachments.id, attachmentId))

  await createAuditLog({
    tenantId,
    userId,
    action: 'delete',
    entityType: 'expense_attachment',
    entityId: attachmentId,
  })

  return { success: true, fileUrl: attachment.fileUrl }
}
