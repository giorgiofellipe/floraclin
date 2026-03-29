'use server'

import { revalidatePath } from 'next/cache'
import { requireRole, getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  listProducts as listProductsQuery,
  getProduct as getProductQuery,
  createProduct as createProductQuery,
  updateProduct as updateProductQuery,
  deleteProduct as deleteProductQuery,
  toggleProductActive as toggleProductActiveQuery,
  toggleProductDiagram as toggleProductDiagramQuery,
} from '@/db/queries/products'

export type ProductActionState = {
  success?: boolean
  error?: string
} | null

// ─── List Products (all roles for active, owner for all) ────────────

export async function listDiagramProductsAction() {
  try {
    const ctx = await getAuthContext()
    return await listProductsQuery(ctx.tenantId, { diagramOnly: true })
  } catch {
    return []
  }
}

export async function listActiveProductsAction() {
  try {
    const ctx = await getAuthContext()
    return await listProductsQuery(ctx.tenantId, { activeOnly: true })
  } catch {
    return []
  }
}

export async function listAllProductsAction() {
  try {
    const ctx = await requireRole('owner')
    return await listProductsQuery(ctx.tenantId)
  } catch {
    return []
  }
}

// ─── Create Product ─────────────────────────────────────────────────

export async function createProductAction(data: {
  name: string
  category: string
  activeIngredient?: string
  defaultUnit?: string
}): Promise<ProductActionState> {
  try {
    const auth = await requireRole('owner')

    if (!data.name?.trim() || !data.category?.trim()) {
      return { error: 'Nome e categoria são obrigatórios' }
    }

    const product = await createProductQuery(auth.tenantId, data)

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'create',
      entityType: 'product',
      entityId: product.id,
      changes: { product: { old: null, new: data } },
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para criar produtos' }
    }
    return { error: 'Erro ao criar produto' }
  }
}

// ─── Update Product ─────────────────────────────────────────────────

export async function updateProductAction(
  id: string,
  data: {
    name?: string
    category?: string
    activeIngredient?: string
    defaultUnit?: string
    isActive?: boolean
  }
): Promise<ProductActionState> {
  try {
    const auth = await requireRole('owner')

    const existing = await getProductQuery(auth.tenantId, id)
    if (!existing) {
      return { error: 'Produto não encontrado' }
    }

    const product = await updateProductQuery(auth.tenantId, id, data)
    if (!product) {
      return { error: 'Erro ao atualizar produto' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'update',
      entityType: 'product',
      entityId: id,
      changes: { product: { old: existing, new: data } },
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para editar produtos' }
    }
    return { error: 'Erro ao atualizar produto' }
  }
}

// ─── Delete Product ─────────────────────────────────────────────────

export async function deleteProductAction(id: string): Promise<ProductActionState> {
  try {
    const auth = await requireRole('owner')

    const product = await deleteProductQuery(auth.tenantId, id)
    if (!product) {
      return { error: 'Produto não encontrado' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'delete',
      entityType: 'product',
      entityId: id,
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para excluir produtos' }
    }
    return { error: 'Erro ao excluir produto' }
  }
}

// ─── Toggle Product Active ──────────────────────────────────────────

export async function toggleProductActiveAction(
  id: string,
  isActive: boolean
): Promise<ProductActionState> {
  try {
    const auth = await requireRole('owner')

    const product = await toggleProductActiveQuery(auth.tenantId, id, isActive)
    if (!product) {
      return { error: 'Produto não encontrado' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'update',
      entityType: 'product',
      entityId: id,
      changes: { isActive: { old: !isActive, new: isActive } },
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para alterar produtos' }
    }
    return { error: 'Erro ao alterar status do produto' }
  }
}

// ─── Toggle Show in Diagram ────────────────────────────────────────

export async function toggleProductDiagramAction(
  id: string,
  showInDiagram: boolean
): Promise<ProductActionState> {
  try {
    const auth = await requireRole('owner')

    const product = await toggleProductDiagramQuery(auth.tenantId, id, showInDiagram)
    if (!product) {
      return { error: 'Produto não encontrado' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'update',
      entityType: 'product',
      entityId: id,
      changes: { showInDiagram: { old: !showInDiagram, new: showInDiagram } },
    })

    revalidatePath('/configuracoes')
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para alterar produtos' }
    }
    return { error: 'Erro ao alterar visibilidade no diagrama' }
  }
}
