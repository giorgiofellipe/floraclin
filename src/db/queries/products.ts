import { db } from '@/db/client'
import { products } from '@/db/schema'
import { eq, and, isNull, asc } from 'drizzle-orm'

export type Product = typeof products.$inferSelect

// ─── Queries ────────────────────────────────────────────────────────

export async function listProducts(
  tenantId: string,
  options?: { activeOnly?: boolean; diagramOnly?: boolean }
): Promise<Product[]> {
  const conditions = [
    eq(products.tenantId, tenantId),
    isNull(products.deletedAt),
  ]

  if (options?.activeOnly) {
    conditions.push(eq(products.isActive, true))
  }

  if (options?.diagramOnly) {
    conditions.push(eq(products.isActive, true))
    conditions.push(eq(products.showInDiagram, true))
  }

  return db
    .select()
    .from(products)
    .where(and(...conditions))
    .orderBy(asc(products.category), asc(products.name))
}

export async function getProduct(
  tenantId: string,
  id: string
): Promise<Product | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, id),
        eq(products.tenantId, tenantId),
        isNull(products.deletedAt)
      )
    )
    .limit(1)

  return product ?? null
}

export async function createProduct(
  tenantId: string,
  data: {
    name: string
    category: string
    activeIngredient?: string
    defaultUnit?: string
    isActive?: boolean
    showInDiagram?: boolean
  },
  txDb: typeof db = db
): Promise<Product> {
  const [product] = await txDb
    .insert(products)
    .values({
      tenantId,
      name: data.name,
      category: data.category,
      activeIngredient: data.activeIngredient ?? null,
      defaultUnit: data.defaultUnit ?? 'U',
      isActive: data.isActive ?? true,
      showInDiagram: data.showInDiagram ?? true,
    })
    .returning()

  return product
}

export async function updateProduct(
  tenantId: string,
  id: string,
  data: Partial<{
    name: string
    category: string
    activeIngredient: string
    defaultUnit: string
    isActive: boolean
    showInDiagram: boolean
  }>
): Promise<Product | null> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.name !== undefined) updateData.name = data.name
  if (data.category !== undefined) updateData.category = data.category
  if (data.activeIngredient !== undefined) updateData.activeIngredient = data.activeIngredient || null
  if (data.defaultUnit !== undefined) updateData.defaultUnit = data.defaultUnit
  if (data.isActive !== undefined) updateData.isActive = data.isActive
  if (data.showInDiagram !== undefined) updateData.showInDiagram = data.showInDiagram

  const [product] = await db
    .update(products)
    .set(updateData)
    .where(
      and(
        eq(products.id, id),
        eq(products.tenantId, tenantId),
        isNull(products.deletedAt)
      )
    )
    .returning()

  return product ?? null
}

export async function deleteProduct(
  tenantId: string,
  id: string
): Promise<Product | null> {
  const [product] = await db
    .update(products)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(products.id, id),
        eq(products.tenantId, tenantId),
        isNull(products.deletedAt)
      )
    )
    .returning()

  return product ?? null
}

export async function toggleProductActive(
  tenantId: string,
  id: string,
  isActive: boolean
): Promise<Product | null> {
  const [product] = await db
    .update(products)
    .set({ isActive, updatedAt: new Date() })
    .where(
      and(
        eq(products.id, id),
        eq(products.tenantId, tenantId),
        isNull(products.deletedAt)
      )
    )
    .returning()

  return product ?? null
}

export async function toggleProductDiagram(
  tenantId: string,
  id: string,
  showInDiagram: boolean
): Promise<Product | null> {
  const [product] = await db
    .update(products)
    .set({ showInDiagram, updatedAt: new Date() })
    .where(
      and(
        eq(products.id, id),
        eq(products.tenantId, tenantId),
        isNull(products.deletedAt)
      )
    )
    .returning()

  return product ?? null
}
