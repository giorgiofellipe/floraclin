/**
 * GET /api/encounters/[id]
 *
 * Task J1: returns every `procedure_record` linked to the given encounter
 * together with their executed `procedure_sessions` (sorted by ordinal) and,
 * when applicable, the parent `patient_packages` row.
 *
 * Tenant-scoped via `requireRole('owner', 'practitioner')`. Responds 404 when
 * no records exist for the supplied encounter id.
 */

import { NextResponse } from 'next/server'
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import {
  patientPackages,
  procedureRecords,
  procedureSessions,
  procedureTypes,
  users,
} from '@/db/schema'
import { listDiagramsForSession } from '@/db/queries/face-diagrams'
import { listProductApplicationsForSession } from '@/db/queries/product-applications'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const { id: encounterId } = await params

    const idParsed = z.string().uuid().safeParse(encounterId)
    if (!idParsed.success) {
      return NextResponse.json(
        { success: false, error: 'encounterId inválido na URL' },
        { status: 400 },
      )
    }

    const records = await db
      .select({
        id: procedureRecords.id,
        procedureTypeName: procedureTypes.name,
        sessionsTotal: procedureRecords.sessionsTotal,
        patientPackageId: procedureRecords.patientPackageId,
      })
      .from(procedureRecords)
      .innerJoin(
        procedureTypes,
        eq(procedureRecords.procedureTypeId, procedureTypes.id),
      )
      .where(
        and(
          eq(procedureRecords.tenantId, ctx.tenantId),
          eq(procedureRecords.encounterId, encounterId),
          // Cancelled lines don't belong in the active picker — no future
          // sessions to execute. Soft-deleted rows are hidden too.
          ne(procedureRecords.status, 'cancelled'),
          isNull(procedureRecords.deletedAt),
        ),
      )
      // Stable order — same on every fetch. Without ORDER BY the rows
      // come back in heap order, which shifts after any UPDATE on the
      // table (e.g., status/performedAt writes when a session is saved).
      // (createdAt, id) gives a deterministic order even when finalize
      // assigns the same `now()` to every line in a single transaction.
      .orderBy(asc(procedureRecords.createdAt), asc(procedureRecords.id))

    if (records.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Not found' },
        { status: 404 },
      )
    }

    const recordIds = records.map((r) => r.id)
    const sessionRows = await db
      .select({
        id: procedureSessions.id,
        procedureRecordId: procedureSessions.procedureRecordId,
        sessionOrdinal: procedureSessions.sessionOrdinal,
        performedAt: procedureSessions.performedAt,
        executedByName: users.fullName,
        technique: procedureSessions.technique,
        clinicalResponse: procedureSessions.clinicalResponse,
        adverseEffects: procedureSessions.adverseEffects,
        notes: procedureSessions.notes,
        followUpDate: procedureSessions.followUpDate,
        nextSessionObjectives: procedureSessions.nextSessionObjectives,
      })
      .from(procedureSessions)
      .innerJoin(users, eq(procedureSessions.executedBy, users.id))
      .where(
        and(
          eq(procedureSessions.tenantId, ctx.tenantId),
          inArray(procedureSessions.procedureRecordId, recordIds),
        ),
      )
      .orderBy(asc(procedureSessions.sessionOrdinal))

    // Eager-load per-session diagrams + product applications so the picker can
    // show a useful read-only view and the orchestrator can prefill the next
    // session from the most recently executed session's data.
    const sessions = await Promise.all(
      sessionRows.map(async (s) => {
        const [diagrams, productApplications] = await Promise.all([
          listDiagramsForSession(ctx.tenantId, s.id),
          listProductApplicationsForSession(ctx.tenantId, s.id),
        ])
        return { ...s, diagrams, productApplications }
      }),
    )

    const packageId = records.find((r) => r.patientPackageId)?.patientPackageId
    let pkg: {
      id: string
      name: string
      status: string
      expiresAt: string | null
      closedAt: Date | null
      closedReason: string | null
    } | null = null
    if (packageId) {
      const [row] = await db
        .select({
          id: patientPackages.id,
          name: patientPackages.name,
          status: patientPackages.status,
          expiresAt: patientPackages.expiresAt,
          closedAt: patientPackages.closedAt,
          closedReason: patientPackages.closedReason,
        })
        .from(patientPackages)
        .where(
          and(
            eq(patientPackages.tenantId, ctx.tenantId),
            eq(patientPackages.id, packageId),
          ),
        )
        .limit(1)
      pkg = row ?? null
    }

    return NextResponse.json({
      success: true,
      data: {
        records: records.map((r) => ({
          id: r.id,
          procedureTypeName: r.procedureTypeName,
          sessionsTotal: r.sessionsTotal,
          sessions: sessions.filter((s) => s.procedureRecordId === r.id),
        })),
        package: pkg,
      },
    })
  } catch (error) {
    return handleApiError(error, request, { body: { success: false, error: 'Erro ao carregar atendimento' } })
  }
}
