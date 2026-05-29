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
import { and, asc, eq, inArray } from 'drizzle-orm'
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

export async function GET(
  _request: Request,
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
        ),
      )

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
    if (error instanceof Error) {
      const msg = error.message
      if (msg.includes('Forbidden')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (msg.includes('redirect') || msg.includes('NEXT_REDIRECT')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
    console.error('GET /api/encounters/[id] error:', error)
    return NextResponse.json(
      { success: false, error: 'Erro ao carregar atendimento' },
      { status: 500 },
    )
  }
}
