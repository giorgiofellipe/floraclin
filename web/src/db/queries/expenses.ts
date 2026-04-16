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
import { startOfBrDay, endOfBrDay, toLocalYmd } from '@/lib/dates'

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
          : toLocalYmd(addDays(today, i * 30))
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
    conditions.push(gte(expenses.createdAt, startOfBrDay(filters.dateFrom)))
  }

  if (filters.dateTo) {
    conditions.push(lte(expenses.createdAt, endOfBrDay(filters.dateTo)))
  }

  if (filters.paymentMethod) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM floraclin.expense_installments ei
        WHERE ei.expense_id = ${expenses.id}
        AND ei.payment_method = ${filters.paymentMethod}
      )`
    )
  }

  if (filters.isOverdue) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM floraclin.expense_installments ei
        WHERE ei.expense_id = ${expenses.id}
        AND ei.status = 'pending'
        AND ei.due_date < CURRENT_DATE
      )`
    )
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
    // 1. Lock installment row with FOR UPDATE to prevent concurrent payments
    const lockResult = await tx.execute(
      sql`SELECT ei.id, ei.expense_id, ei.amount, ei.status, ei.installment_number, e.category_id
          FROM floraclin.expense_installments ei
          INNER JOIN floraclin.expenses e ON e.id = ei.expense_id
          WHERE ei.id = ${installmentId}
          AND e.tenant_id = ${tenantId}
          AND e.deleted_at IS NULL
          FOR UPDATE OF ei`
    )

    const rows = (Array.isArray(lockResult) ? lockResult : (lockResult as Record<string, unknown>).rows ?? lockResult) as Record<string, unknown>[]
    const row = rows[0] as Record<string, unknown> | undefined

    if (!row) {
      throw new Error('Parcela não encontrada ou não pertence a esta clínica')
    }

    const installment = {
      id: String(row.id),
      expenseId: String(row.expense_id),
      amount: String(row.amount),
      status: String(row.status),
      installmentNumber: Number(row.installment_number),
      categoryId: row.category_id ? String(row.category_id) : null,
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

export async function revertExpenseInstallmentPayment(
  tenantId: string,
  installmentId: string,
  userId: string,
  reason?: string,
) {
  return withTransaction(async (tx) => {
    const lockResult = await tx.execute(
      sql`SELECT ei.id, ei.expense_id, ei.amount, ei.status, ei.installment_number,
                 ei.paid_at, ei.payment_method,
                 e.status AS expense_status, e.category_id,
                 cm.id AS movement_id
          FROM floraclin.expense_installments ei
          INNER JOIN floraclin.expenses e ON e.id = ei.expense_id
          LEFT JOIN floraclin.cash_movements cm
            ON cm.expense_installment_id = ei.id
            AND cm.type = 'outflow'
            AND cm.reversed_by_movement_id IS NULL
          WHERE ei.id = ${installmentId}
            AND e.tenant_id = ${tenantId}
            AND e.deleted_at IS NULL
          FOR UPDATE OF ei`,
    )

    const rows = (Array.isArray(lockResult)
      ? lockResult
      : (lockResult as Record<string, unknown>).rows ?? lockResult) as Record<string, unknown>[]
    const row = rows[0]

    if (!row) throw new Error('Parcela não encontrada ou não pertence a esta clínica')
    if (String(row.expense_status) === 'cancelled') throw new Error('Despesa cancelada')
    if (String(row.status) !== 'paid') throw new Error('Parcela não está paga')

    const originalMovementId = row.movement_id ? String(row.movement_id) : null
    const prevPaidAt = row.paid_at ? new Date(row.paid_at as string | Date) : null
    const prevPaymentMethod = row.payment_method ? String(row.payment_method) : null
    const installmentNumber = Number(row.installment_number)
    const expenseId = String(row.expense_id)
    const amount = String(row.amount)
    const categoryId = row.category_id ? String(row.category_id) : null

    const [counter] = await tx
      .insert(cashMovements)
      .values({
        tenantId,
        type: 'inflow',
        amount,
        description: `Estorno: Despesa parcela ${installmentNumber}${reason ? ` — ${reason}` : ''}`,
        // null: counter movement is a ledger reversal, not a real inflow via
        // the original channel. Avoids fictitious inflows in per-method reports.
        paymentMethod: null,
        movementDate: new Date(),
        expenseInstallmentId: installmentId,
        expenseCategoryId: categoryId,
        recordedBy: userId,
      })
      .returning({ id: cashMovements.id })

    if (originalMovementId && counter) {
      await tx
        .update(cashMovements)
        .set({ reversedByMovementId: counter.id })
        .where(eq(cashMovements.id, originalMovementId))
    }

    const [updated] = await tx
      .update(expenseInstallments)
      .set({ status: 'pending', paidAt: null, paymentMethod: null })
      .where(eq(expenseInstallments.id, installmentId))
      .returning()

    if (String(row.expense_status) === 'paid') {
      await tx
        .update(expenses)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(expenses.id, expenseId))
    }

    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'expense_installment',
        entityId: installmentId,
        changes: {
          status: { old: 'paid', new: 'pending' },
          paidAt: { old: prevPaidAt ? prevPaidAt.toISOString() : null, new: null },
          paymentMethod: { old: prevPaymentMethod, new: null },
          ...(reason ? { reason: { old: null, new: reason } } : {}),
        },
      },
      tx,
    )

    return updated
  })
}

interface UpdateExpenseArgs {
  description: string
  categoryId: string
  notes?: string
  totalAmount: number
  installmentCount: number
  unpaidDueDates: string[]
}

export async function updateExpense(
  tenantId: string,
  expenseId: string,
  userId: string,
  input: UpdateExpenseArgs,
) {
  // Verify categoryId belongs to this tenant or is a system default (matches createExpense).
  const [category] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.id, input.categoryId),
        isNull(expenseCategories.deletedAt),
        sql`(${expenseCategories.tenantId} = ${tenantId} OR ${expenseCategories.tenantId} IS NULL)`,
      ),
    )
    .limit(1)

  if (!category) {
    throw new Error('Categoria não encontrada ou não pertence a esta clínica')
  }

  return withTransaction(async (tx) => {
    // Lock the parent expense row to prevent concurrent cancellation mid-update.
    const [expense] = await tx
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.tenantId, tenantId),
          eq(expenses.id, expenseId),
          isNull(expenses.deletedAt),
        ),
      )
      .for('update')
      .limit(1)

    if (!expense) throw new Error('Despesa não encontrada')
    if (expense.status === 'cancelled') throw new Error('Despesa cancelada')

    // Lock + read installments in one go (prevents TOCTOU)
    const lockedRows = await tx.execute(
      sql`SELECT id, installment_number, amount, status
          FROM floraclin.expense_installments
          WHERE expense_id = ${expenseId}
          FOR UPDATE`,
    )

    const rows = (Array.isArray(lockedRows)
      ? lockedRows
      : (lockedRows as Record<string, unknown>).rows ?? lockedRows) as Record<string, unknown>[]

    const existingInstallments = rows.map((r) => ({
      id: String(r.id),
      installmentNumber: Number(r.installment_number),
      amountCents: Math.round(Number(r.amount) * 100),
      status: String(r.status),
    }))

    const paidInstallments = existingInstallments.filter((i) => i.status === 'paid')
    const unpaidInstallments = existingInstallments.filter((i) => i.status !== 'paid')
    const paidCount = paidInstallments.length
    const sumPaidCents = paidInstallments.reduce((acc, i) => acc + i.amountCents, 0)

    const newTotalCents = Math.round(input.totalAmount * 100)
    const newCount = input.installmentCount
    const unpaidCount = newCount - paidCount
    const remainingCents = newTotalCents - sumPaidCents

    if (newTotalCents < sumPaidCents) throw new Error('Valor menor que o já pago')
    if (newCount < paidCount) throw new Error('Parcelas menor que as já pagas')
    if ((remainingCents === 0) !== (unpaidCount === 0)) {
      throw new Error('Valor e parcelas inconsistentes')
    }
    if (input.unpaidDueDates.length !== unpaidCount) {
      throw new Error('Quantidade de datas não bate com as parcelas pendentes')
    }

    const scalarChanges: Record<string, { old: unknown; new: unknown }> = {}
    if (expense.description !== input.description) {
      scalarChanges.description = { old: expense.description, new: input.description }
    }
    if (expense.categoryId !== input.categoryId) {
      scalarChanges.categoryId = { old: expense.categoryId, new: input.categoryId }
    }
    if ((expense.notes ?? null) !== (input.notes ?? null)) {
      scalarChanges.notes = { old: expense.notes ?? null, new: input.notes ?? null }
    }
    const oldTotalCents = Math.round(Number(expense.totalAmount) * 100)
    if (oldTotalCents !== newTotalCents) {
      scalarChanges.totalAmount = { old: oldTotalCents / 100, new: newTotalCents / 100 }
    }
    if (expense.installmentCount !== newCount) {
      scalarChanges.installmentCount = { old: expense.installmentCount, new: newCount }
    }

    await tx
      .update(expenses)
      .set({
        description: input.description,
        categoryId: input.categoryId,
        notes: input.notes ?? null,
        totalAmount: (newTotalCents / 100).toFixed(2),
        installmentCount: newCount,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, expenseId))

    if (unpaidInstallments.length > 0) {
      await tx
        .delete(expenseInstallments)
        .where(
          and(
            eq(expenseInstallments.expenseId, expenseId),
            sql`${expenseInstallments.status} <> 'paid'`,
          ),
        )
    }

    if (unpaidCount > 0) {
      const perSlotCents = Math.floor(remainingCents / unpaidCount)
      const remainderCents = remainingCents - perSlotCents * unpaidCount
      let sumCheckCents = 0
      for (let i = 0; i < unpaidCount; i++) {
        const amountCents = perSlotCents + (i === 0 ? remainderCents : 0)
        sumCheckCents += amountCents
        await tx.insert(expenseInstallments).values({
          expenseId,
          installmentNumber: paidCount + i + 1,
          amount: (amountCents / 100).toFixed(2),
          dueDate: input.unpaidDueDates[i],
          status: 'pending',
        })
      }
      // Defensive invariant: sum of regenerated installments + paid must equal new total
      if (sumCheckCents + sumPaidCents !== newTotalCents) {
        throw new Error('Erro interno: distribuição de parcelas inconsistente')
      }
    }

    if (unpaidCount === 0 && paidCount > 0 && expense.status !== 'paid') {
      await tx
        .update(expenses)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(eq(expenses.id, expenseId))
    } else if (unpaidCount > 0 && expense.status === 'paid') {
      await tx
        .update(expenses)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(expenses.id, expenseId))
    }

    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'expense',
        entityId: expenseId,
        changes: {
          ...scalarChanges,
          installmentsRegenerated: {
            old: unpaidInstallments.length,
            new: unpaidCount,
          },
        },
      },
      tx,
    )

    return { success: true }
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

    // Unpaid installments remain as 'pending' — the parent expense
    // status 'cancelled' is the source of truth. Expense installments
    // only have 'pending' and 'paid' as valid statuses.

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
