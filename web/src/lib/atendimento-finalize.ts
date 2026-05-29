/**
 * finalizeAtendimento — converts a wizard-managed set of draft
 * `procedure_records` into an approved atendimento, optionally creating a
 * `patient_packages` row, a `financial_entries` row (with installments), and
 * one `consent_acceptances` row per draft × consent.
 *
 * Design notes (see docs/plans/2026-05-28-package-atendimento-redesign-cook.md):
 *
 *   - Patch P1: This finalizes drafts **in place**. The wizard has already
 *     persisted one draft row per cart line during step 2/3 (plus any
 *     diagrams, products, and `plannedSnapshot` payload). Approval MUST NOT
 *     create fresh rows or it would orphan that side data. Caller passes the
 *     ordered `draftRecordIds` array (same order as `cart.lines`); each draft
 *     is locked `FOR UPDATE` inside the tx, asserted to be `draft` | `planned`
 *     for the same tenant + patient, then UPDATEd to `approved` with
 *     `patientPackageId`, `atendimentoId`, `sessionsTotal`, `financialPlan`
 *     set. `plannedSnapshot` is intentionally left untouched.
 *
 *   - Patch P1: Financial side uses `createFinancialEntry(...)` from
 *     `@/db/queries/financial` — the helper that owns the entry-plus-
 *     installments insert. No raw `financialEntries.insert(...)` here.
 *
 *   - Patch P5: Package expiry anchors at BR noon (`parseBrDate(brToday(),
 *     '12:00:00')`) before `addMonths`, then `toBrYmd(...)`. Avoids the UTC
 *     drift that `addMonths(new Date(), N)` would produce on UTC containers.
 *
 *   - Patch P7: `procedure_records.status` is independent of
 *     `patient_packages.closedAt`. Closing a package early does NOT cascade
 *     into the lines — the picker / executor gate on package state
 *     separately. C1 doesn't deal with closure; this comment documents the
 *     resolution so a future maintainer doesn't try to "fix" it.
 */

import { db } from '@/db/client'
import {
  patientPackages,
  procedureRecords,
  consentAcceptances,
} from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { createFinancialEntry } from '@/db/queries/financial'
import {
  autoPackageName,
  computeCartTotal,
  isBundleCart,
  type AtendimentoCart,
} from '@/validations/atendimento-cart'
import { brToday, parseBrDate, toBrYmd } from '@/lib/dates'
import { addMonths } from 'date-fns'
import { createAuditLog } from '@/lib/audit'

export interface FinalizeAtendimentoInput {
  tenantId: string
  userId: string
  patientId: string
  practitionerId: string
  cart: AtendimentoCart
  /** One draft record id per cart line, in the same order as `cart.lines`. */
  draftRecordIds: string[]
  financialPlan: {
    totalAmount: string
    installmentCount: number
    paymentMethod: string
    notes?: string
  }
  consents: Array<{
    consentTemplateId: string
    signatureData: string
    contentSnapshot: string
    contentHash: string
    acceptanceMethod: string
  }>
  tenantDefaultValidityMonths?: number | null
}

export interface FinalizeAtendimentoResult {
  atendimentoId: string
  patientPackageId: string | null
  procedureRecordIds: string[]
  financialEntryId: string
}

/**
 * Compute the package expiry as a BR calendar day. Anchors at BR noon to
 * avoid DST / UTC-midnight day drift. Returns `null` when validity is null
 * (open-ended packages).
 */
function computeExpiresAt(validityMonths: number | null): string | null {
  if (validityMonths === null || validityMonths === undefined) return null
  const anchor = parseBrDate(brToday(), '12:00:00')
  return toBrYmd(addMonths(anchor, validityMonths))
}

export async function finalizeAtendimento(
  input: FinalizeAtendimentoInput,
  outerTx?: typeof db,
): Promise<FinalizeAtendimentoResult> {
  if (input.draftRecordIds.length !== input.cart.lines.length) {
    throw new Error(
      `draftRecordIds length (${input.draftRecordIds.length}) does not match cart.lines length (${input.cart.lines.length})`,
    )
  }

  const run = async (tx: typeof db): Promise<FinalizeAtendimentoResult> => {
    const atendimentoId = crypto.randomUUID()
    const isBundle = isBundleCart(input.cart)
    const total = computeCartTotal(input.cart)

    // 1. Lock all draft procedure_records FOR UPDATE inside the tx. Scope
    //    by tenant + patient so we can't be tricked into approving a draft
    //    from another tenant / patient. Use a raw SQL fragment so we can
    //    issue `FOR UPDATE` — drizzle's pg dialect supports `.for('update')`
    //    on select chains, but going through `tx.execute` keeps the lock
    //    explicit and matches the pattern used in `cancelPackage` /
    //    `recordPayment`.
    const lockResult = await tx.execute(sql`
      SELECT id, tenant_id, patient_id, status, planned_snapshot
      FROM floraclin.procedure_records
      WHERE id IN (${sql.join(
        input.draftRecordIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND tenant_id = ${input.tenantId}
        AND patient_id = ${input.patientId}
      FOR UPDATE
    `)
    const lockedRows = (Array.isArray(lockResult)
      ? lockResult
      : (lockResult as { rows?: Record<string, unknown>[] }).rows ?? lockResult) as Record<string, unknown>[]

    if (lockedRows.length !== input.draftRecordIds.length) {
      throw new Error(
        'Um ou mais rascunhos de procedimento não foram encontrados ou não pertencem a este paciente/clínica.',
      )
    }

    const allowedStatuses = new Set(['draft', 'planned'])
    for (const row of lockedRows) {
      const status = String(row.status)
      if (!allowedStatuses.has(status)) {
        throw new Error(
          `Rascunho de procedimento ${String(row.id)} já está em estado '${status}' e não pode ser aprovado.`,
        )
      }
    }

    // 2. Optional package row. Created BEFORE the financial entry so we
    //    have a name to use in the entry description, but we still need the
    //    financial_entry id to satisfy the NOT NULL FK on patient_packages.
    //    Resolve by creating the financial entry first, then the package,
    //    then back-fill patientPackageId on the records in step 4.
    const packageName = isBundle ? autoPackageName(input.cart) : null

    // 3. Financial entry (Patch P1) — use the shared helper so installments
    //    are produced alongside. The helper takes `totalAmount` as a number;
    //    we accept a string in the input (matching the wizard's RHF payload),
    //    so parse here.
    const totalAmount = Number(input.financialPlan.totalAmount)
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new Error(
        `financialPlan.totalAmount inválido: '${input.financialPlan.totalAmount}'`,
      )
    }

    const description = packageName ?? `Atendimento — ${input.cart.lines.map((l) => l.procedureTypeName).join(', ')}`

    const feEntry = await createFinancialEntry(
      input.tenantId,
      input.userId,
      {
        patientId: input.patientId,
        description,
        totalAmount,
        installmentCount: input.financialPlan.installmentCount,
        notes: input.financialPlan.notes,
      },
      tx,
    )

    // 4. Patient package (only for bundles).
    let patientPackageId: string | null = null
    if (isBundle) {
      const validityMonths =
        input.cart.templateValidityMonths ?? input.tenantDefaultValidityMonths ?? null
      const expiresAt = computeExpiresAt(validityMonths)

      const [pkgRow] = await tx
        .insert(patientPackages)
        .values({
          tenantId: input.tenantId,
          patientId: input.patientId,
          templateId: input.cart.templateId,
          name: packageName!,
          totalAmount: total.toFixed(2),
          purchasedAt: brToday(),
          expiresAt,
          status: 'active',
          financialEntryId: feEntry.id,
          soldBy: input.practitionerId,
        })
        .returning({ id: patientPackages.id })
      patientPackageId = pkgRow.id
    }

    // 5. Finalize drafts in place. We do one UPDATE per record because each
    //    line carries a distinct `sessionsTotal`. `plannedSnapshot` is
    //    intentionally absent from the SET — Patch P1 mandates we preserve
    //    whatever the wizard wrote during step 2/3.
    const now = new Date()
    for (let i = 0; i < input.draftRecordIds.length; i++) {
      const recordId = input.draftRecordIds[i]
      const line = input.cart.lines[i]
      await tx
        .update(procedureRecords)
        .set({
          status: 'approved',
          approvedAt: now,
          atendimentoId,
          patientPackageId,
          sessionsTotal: line.sessions,
          financialPlan: input.financialPlan,
          updatedAt: now,
        })
        .where(
          and(
            eq(procedureRecords.id, recordId),
            eq(procedureRecords.tenantId, input.tenantId),
          ),
        )
    }

    // Back-fill the financial_entries.procedure_record_id pointer with the
    // first draft (the "primary" record for the atendimento). This keeps
    // the legacy 1:1 link useful for single-line ad-hoc atendimentos; for
    // multi-line packages, the package row holds the canonical link via
    // financialEntryId. Raw SQL because the typed update path here would
    // require pulling `financialEntries` into scope just for one field and
    // contributes nothing — this is a straight UPDATE by id.
    await tx.execute(sql`
      UPDATE floraclin.financial_entries
      SET procedure_record_id = ${input.draftRecordIds[0]}
      WHERE id = ${feEntry.id}
        AND tenant_id = ${input.tenantId}
    `)

    // 6. Consent acceptances — one per (draftRecordId × consent).
    for (const recordId of input.draftRecordIds) {
      for (const consent of input.consents) {
        await tx.insert(consentAcceptances).values({
          tenantId: input.tenantId,
          patientId: input.patientId,
          consentTemplateId: consent.consentTemplateId,
          procedureRecordId: recordId,
          acceptanceMethod: consent.acceptanceMethod,
          signatureData: consent.signatureData,
          contentHash: consent.contentHash,
          contentSnapshot: consent.contentSnapshot,
          acceptedAt: now,
        })
      }
    }

    // 7. Audit log.
    await createAuditLog(
      {
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'create',
        entityType: 'atendimento',
        entityId: atendimentoId,
        changes: {
          patientPackageId: { old: null, new: patientPackageId },
          procedureRecords: { old: [], new: input.draftRecordIds },
          financialEntryId: { old: null, new: feEntry.id },
        },
      },
      tx,
    )

    return {
      atendimentoId,
      patientPackageId,
      procedureRecordIds: [...input.draftRecordIds],
      financialEntryId: feEntry.id,
    }
  }

  if (outerTx) return run(outerTx)
  return db.transaction((tx) => run(tx as unknown as typeof db))
}

// Re-export internals for testing only.
export const __test__ = { computeExpiresAt }
