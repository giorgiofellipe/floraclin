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

/**
 * Persist product applications for a single procedure session.
 *
 * Per-session granularity: deletes only the rows belonging to
 * `procedureSessionId` before inserting the supplied applications. Rows from
 * sibling sessions on the same procedure record are left untouched.
 */
export async function saveProductApplicationsForSession(
  tenantId: string,
  procedureRecordId: string,
  procedureSessionId: string,
  applications: ProductApplicationItem[],
  txDb: typeof db = db
) {
  // Delete existing applications for THIS session only
  await txDb
    .delete(productApplications)
    .where(
      and(
        eq(productApplications.tenantId, tenantId),
        eq(productApplications.procedureSessionId, procedureSessionId)
      )
    )

  if (applications.length === 0) return []

  // Insert new applications, anchored to both the record and the session
  const inserted = await txDb
    .insert(productApplications)
    .values(
      applications.map((app) => ({
        tenantId,
        procedureRecordId,
        procedureSessionId,
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

/**
 * Read all product applications for a procedure record (across every session).
 *
 * Used for read-side aggregation — e.g. printed procedure summaries that need
 * the full history regardless of which session applied each product.
 */
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

/**
 * Read product applications for a single procedure session.
 *
 * Used by session-scoped views (e.g. the in-session execution screen) where
 * we only want what was applied during a specific visit.
 */
export async function listProductApplicationsForSession(
  tenantId: string,
  procedureSessionId: string,
  txDb: typeof db = db
): Promise<ProductApplicationRecord[]> {
  return txDb
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
        eq(productApplications.procedureSessionId, procedureSessionId)
      )
    )
    .orderBy(productApplications.productName)
}
