import { db } from '@/db/client'
import { productApplications } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import type { ProductApplicationItem } from '@/validations/procedure'

// ─── Types ──────────────────────────────────────────────────────────

export interface ProductApplicationRecord {
  id: string
  productName: string
  activeIngredient: string | null
  totalQuantity: string
  quantityUnit: string
  batchNumber: string | null
  expirationDate: string | null
  labelPhotoId: string | null
  applicationAreas: string | null
  notes: string | null
}

// ─── Queries ────────────────────────────────────────────────────────

export async function saveProductApplications(
  tenantId: string,
  procedureRecordId: string,
  applications: ProductApplicationItem[],
  txDb: typeof db = db
) {
  // Delete existing applications for this procedure
  await txDb
    .delete(productApplications)
    .where(
      and(
        eq(productApplications.tenantId, tenantId),
        eq(productApplications.procedureRecordId, procedureRecordId)
      )
    )

  if (applications.length === 0) return []

  // Insert new applications
  const inserted = await txDb
    .insert(productApplications)
    .values(
      applications.map((app) => ({
        tenantId,
        procedureRecordId,
        productName: app.productName,
        activeIngredient: app.activeIngredient ?? null,
        totalQuantity: app.totalQuantity.toFixed(2),
        quantityUnit: app.quantityUnit,
        batchNumber: app.batchNumber ?? null,
        expirationDate: app.expirationDate ?? null,
        labelPhotoId: app.labelPhotoId ?? null,
        applicationAreas: app.applicationAreas ?? null,
        notes: app.notes ?? null,
      }))
    )
    .returning()

  return inserted
}

export async function getProductApplications(
  tenantId: string,
  procedureRecordId: string
): Promise<ProductApplicationRecord[]> {
  return db
    .select({
      id: productApplications.id,
      productName: productApplications.productName,
      activeIngredient: productApplications.activeIngredient,
      totalQuantity: productApplications.totalQuantity,
      quantityUnit: productApplications.quantityUnit,
      batchNumber: productApplications.batchNumber,
      expirationDate: productApplications.expirationDate,
      labelPhotoId: productApplications.labelPhotoId,
      applicationAreas: productApplications.applicationAreas,
      notes: productApplications.notes,
    })
    .from(productApplications)
    .where(
      and(
        eq(productApplications.tenantId, tenantId),
        eq(productApplications.procedureRecordId, procedureRecordId)
      )
    )
    .orderBy(productApplications.productName)
}
