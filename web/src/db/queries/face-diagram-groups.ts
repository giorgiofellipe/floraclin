import { db } from '@/db/client'
import {
  faceDiagramGroups,
  faceDiagrams,
  diagramPoints,
  patients,
  procedureRecords,
  procedureSessions,
  procedureTypes,
  users,
} from '@/db/schema'
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { isOpenStatus } from '@/lib/procedure-status'
import { quoteTotal } from '@/lib/diagram-quote'
import {
  deriveDiagramStatus,
  type DiagramGroupStatus,
} from '@/lib/face-diagram-status'
import type { DiagramGroupOrigin, QuotationLine } from '@/validations/face-diagram-group'
import type { DiagramViewType, ProcedureStatus } from '@/types'
import type { DiagramPointInput, DiagramWithPoints } from './face-diagrams'

export class DiagramGroupLockedError extends Error {}
export class DiagramGroupNotFoundError extends Error {
  constructor() {
    super('Diagrama não encontrado')
  }
}
export class InvalidQuotationLineError extends Error {
  constructor() {
    super('Procedimento inválido no orçamento')
  }
}

export interface DiagramViewInput {
  viewType: DiagramViewType
  points: DiagramPointInput[]
}

export interface DiagramGroupDetail {
  id: string
  patientId: string
  practitionerId: string
  practitionerName: string | null
  origin: DiagramGroupOrigin
  status: DiagramGroupStatus
  procedureRecordId: string | null
  procedureSessionId: string | null
  sessionOrdinal: number | null
  procedureTypeName: string | null
  procedurePerformedAt: Date | null
  quotationLines: QuotationLine[]
  quotationTotal: number | null
  createdAt: Date
  updatedAt: Date
  views: DiagramWithPoints[]
}

// ─── Shared view helpers ────────────────────────────────────────────

export async function loadDiagramsWithPoints(
  txDb: typeof db,
  diagramRows: { id: string; viewType: string }[],
): Promise<DiagramWithPoints[]> {
  if (diagramRows.length === 0) return []
  const points = await txDb
    .select()
    .from(diagramPoints)
    .where(inArray(diagramPoints.faceDiagramId, diagramRows.map((d) => d.id)))
    .orderBy(diagramPoints.sortOrder)

  return diagramRows.map((d) => ({
    id: d.id,
    viewType: d.viewType,
    points: points.filter((p) => p.faceDiagramId === d.id),
  }))
}

/** Upserts one view of a group and replaces its points. Caller holds the group lock. */
export async function writeGroupView(
  txDb: typeof db,
  tenantId: string,
  groupId: string,
  viewType: DiagramViewType,
  points: DiagramPointInput[],
): Promise<string | null> {
  const [existing] = await txDb
    .select({ id: faceDiagrams.id })
    .from(faceDiagrams)
    .where(
      and(
        eq(faceDiagrams.tenantId, tenantId),
        eq(faceDiagrams.groupId, groupId),
        eq(faceDiagrams.viewType, viewType),
      ),
    )
    .limit(1)

  if (points.length === 0) {
    if (existing) await txDb.delete(faceDiagrams).where(eq(faceDiagrams.id, existing.id))
    return null
  }

  let diagramId: string
  if (existing) {
    diagramId = existing.id
    await txDb.update(faceDiagrams).set({ updatedAt: new Date() }).where(eq(faceDiagrams.id, diagramId))
    await txDb.delete(diagramPoints).where(eq(diagramPoints.faceDiagramId, diagramId))
  } else {
    const [diagram] = await txDb
      .insert(faceDiagrams)
      .values({ tenantId, groupId, viewType })
      .returning({ id: faceDiagrams.id })
    diagramId = diagram.id
  }

  if (points.length > 0) {
    await txDb.insert(diagramPoints).values(
      points.map((point, index) => ({
        tenantId,
        faceDiagramId: diagramId,
        x: point.x.toFixed(2),
        y: point.y.toFixed(2),
        productName: point.productName,
        activeIngredient: point.activeIngredient ?? null,
        quantity: point.quantity.toFixed(2),
        quantityUnit: point.quantityUnit,
        technique: point.technique ?? null,
        depth: point.depth ?? null,
        notes: point.notes ?? null,
        sortOrder: index,
      })),
    )
  }
  return diagramId
}

// ─── Group lifecycle ────────────────────────────────────────────────

export async function findPlanningGroupId(
  tx: typeof db,
  tenantId: string,
  procedureRecordId: string,
): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: faceDiagramGroups.id })
    .from(faceDiagramGroups)
    .where(
      and(
        eq(faceDiagramGroups.tenantId, tenantId),
        eq(faceDiagramGroups.procedureRecordId, procedureRecordId),
        isNull(faceDiagramGroups.procedureSessionId),
        isNull(faceDiagramGroups.deletedAt),
      ),
    )
    .limit(1)
  return row?.id
}

export async function ensurePlanningGroup(
  tx: typeof db,
  input: { tenantId: string; patientId: string; practitionerId: string; procedureRecordId: string },
): Promise<string> {
  const findExisting = () => findPlanningGroupId(tx, input.tenantId, input.procedureRecordId)

  const existing = await findExisting()
  if (existing) return existing

  const [created] = await tx
    .insert(faceDiagramGroups)
    .values({
      tenantId: input.tenantId,
      patientId: input.patientId,
      practitionerId: input.practitionerId,
      procedureRecordId: input.procedureRecordId,
      origin: 'wizard',
    })
    .onConflictDoNothing()
    .returning({ id: faceDiagramGroups.id })
  if (created) return created.id

  const raced = await findExisting()
  if (!raced) throw new Error('Falha ao criar grupo de diagrama')
  return raced
}

export async function ensureSessionGroup(
  tx: typeof db,
  input: {
    tenantId: string
    patientId: string
    practitionerId: string
    procedureRecordId: string
    procedureSessionId: string
  },
): Promise<string> {
  const [existing] = await tx
    .select({ id: faceDiagramGroups.id })
    .from(faceDiagramGroups)
    .where(
      and(
        eq(faceDiagramGroups.tenantId, input.tenantId),
        eq(faceDiagramGroups.procedureSessionId, input.procedureSessionId),
      ),
    )
    .limit(1)
  if (existing) return existing.id

  const [created] = await tx
    .insert(faceDiagramGroups)
    .values({
      tenantId: input.tenantId,
      patientId: input.patientId,
      practitionerId: input.practitionerId,
      procedureRecordId: input.procedureRecordId,
      procedureSessionId: input.procedureSessionId,
      origin: 'wizard',
    })
    .returning({ id: faceDiagramGroups.id })
  return created.id
}

/** Rewrites each line's name from the tenant's active procedure types; rejects unknown ids. */
async function resolveQuotationLines(
  tx: typeof db,
  tenantId: string,
  lines: QuotationLine[],
): Promise<QuotationLine[]> {
  if (lines.length === 0) return []
  const types = await tx
    .select({ id: procedureTypes.id, name: procedureTypes.name })
    .from(procedureTypes)
    .where(
      and(
        eq(procedureTypes.tenantId, tenantId),
        inArray(procedureTypes.id, lines.map((l) => l.procedureTypeId)),
        eq(procedureTypes.isActive, true),
        isNull(procedureTypes.deletedAt),
      ),
    )
  const nameOf = new Map(types.map((t) => [t.id, t.name]))
  return lines.map((line) => {
    const name = nameOf.get(line.procedureTypeId)
    if (!name) throw new InvalidQuotationLineError()
    return { ...line, procedureTypeName: name }
  })
}

export async function createStandaloneGroup(
  tx: typeof db,
  input: {
    tenantId: string
    patientId: string
    practitionerId: string
    views: DiagramViewInput[]
    quotationLines: QuotationLine[]
  },
): Promise<string> {
  const quotationLines = await resolveQuotationLines(tx, input.tenantId, input.quotationLines)
  const [group] = await tx
    .insert(faceDiagramGroups)
    .values({
      tenantId: input.tenantId,
      patientId: input.patientId,
      practitionerId: input.practitionerId,
      origin: 'standalone',
      quotationLines,
    })
    .returning({ id: faceDiagramGroups.id })

  for (const view of input.views) {
    await writeGroupView(tx, input.tenantId, group.id, view.viewType, view.points)
  }
  return group.id
}

export interface LockedDiagramGroup {
  id: string
  patientId: string
  origin: DiagramGroupOrigin
  procedureRecordId: string | null
  procedureSessionId: string | null
  declinedAt: Date | null
  procedureStatus: ProcedureStatus | null
  status: DiagramGroupStatus
}

export async function lockDiagramGroup(
  tx: typeof db,
  tenantId: string,
  groupId: string,
): Promise<LockedDiagramGroup | null> {
  const [group] = await tx
    .select({
      id: faceDiagramGroups.id,
      patientId: faceDiagramGroups.patientId,
      origin: faceDiagramGroups.origin,
      procedureRecordId: faceDiagramGroups.procedureRecordId,
      procedureSessionId: faceDiagramGroups.procedureSessionId,
      declinedAt: faceDiagramGroups.declinedAt,
    })
    .from(faceDiagramGroups)
    .where(
      and(
        eq(faceDiagramGroups.id, groupId),
        eq(faceDiagramGroups.tenantId, tenantId),
        isNull(faceDiagramGroups.deletedAt),
      ),
    )
    .for('update')
    .limit(1)
  if (!group) return null

  let procedureStatus: ProcedureStatus | null = null
  if (group.procedureRecordId) {
    const [record] = await tx
      .select({ status: procedureRecords.status })
      .from(procedureRecords)
      .where(
        and(
          eq(procedureRecords.id, group.procedureRecordId),
          eq(procedureRecords.tenantId, tenantId),
        ),
      )
      .limit(1)
    procedureStatus = (record?.status as ProcedureStatus | undefined) ?? null
  }

  return {
    ...group,
    origin: group.origin as DiagramGroupOrigin,
    procedureStatus,
    status: deriveDiagramStatus({
      isSessionGroup: !!group.procedureSessionId,
      procedureStatus,
      declinedAt: group.declinedAt,
    }),
  }
}

export async function updateStandaloneGroup(
  tx: typeof db,
  input: {
    tenantId: string
    groupId: string
    views: DiagramViewInput[]
    quotationLines: QuotationLine[]
  },
): Promise<void> {
  const group = await lockDiagramGroup(tx, input.tenantId, input.groupId)
  if (!group) throw new DiagramGroupNotFoundError()
  if (group.status !== 'quote') {
    throw new DiagramGroupLockedError('Este diagrama não pode mais ser editado')
  }
  const quotationLines = await resolveQuotationLines(tx, input.tenantId, input.quotationLines)

  await tx
    .update(faceDiagramGroups)
    .set({ quotationLines, updatedAt: new Date() })
    .where(eq(faceDiagramGroups.id, input.groupId))

  await tx
    .delete(faceDiagrams)
    .where(
      and(
        eq(faceDiagrams.groupId, input.groupId),
        notInArray(faceDiagrams.viewType, input.views.map((v) => v.viewType)),
      ),
    )

  for (const view of input.views) {
    await writeGroupView(tx, input.tenantId, input.groupId, view.viewType, view.points)
  }
}

export async function linkGroupToProcedure(
  tx: typeof db,
  input: { tenantId: string; patientId: string; groupId: string; procedureRecordId: string },
): Promise<void> {
  const group = await lockDiagramGroup(tx, input.tenantId, input.groupId)
  if (!group) throw new DiagramGroupNotFoundError()
  if (group.patientId !== input.patientId) {
    throw new DiagramGroupLockedError('Este diagrama pertence a outro paciente')
  }
  if (group.status !== 'quote') {
    throw new DiagramGroupLockedError('Este diagrama já está em outro atendimento')
  }

  // Serializes concurrent links for the same patient so only one can pass the open-procedure check.
  await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, input.patientId), eq(patients.tenantId, input.tenantId)))
    .for('update')

  const others = await tx
    .select({ id: procedureRecords.id, status: procedureRecords.status })
    .from(procedureRecords)
    .where(
      and(
        eq(procedureRecords.tenantId, input.tenantId),
        eq(procedureRecords.patientId, input.patientId),
        isNull(procedureRecords.deletedAt),
      ),
    )
  const hasOtherOpen = others.some(
    (r) => r.id !== input.procedureRecordId && isOpenStatus(r.status as ProcedureStatus),
  )
  if (hasOtherOpen) {
    throw new DiagramGroupLockedError('O paciente já tem outro atendimento em aberto')
  }

  await tx
    .update(faceDiagramGroups)
    .set({ procedureRecordId: input.procedureRecordId, updatedAt: new Date() })
    .where(eq(faceDiagramGroups.id, input.groupId))
}

export async function releaseStandaloneGroups(
  tx: typeof db,
  tenantId: string,
  procedureRecordIds: string[],
): Promise<string[]> {
  if (procedureRecordIds.length === 0) return []
  const released = await tx
    .update(faceDiagramGroups)
    .set({ procedureRecordId: null, updatedAt: new Date() })
    .where(
      and(
        eq(faceDiagramGroups.tenantId, tenantId),
        inArray(faceDiagramGroups.procedureRecordId, procedureRecordIds),
        isNull(faceDiagramGroups.procedureSessionId),
        eq(faceDiagramGroups.origin, 'standalone'),
      ),
    )
    .returning({ id: faceDiagramGroups.id })
  return released.map((g) => g.id)
}

// ─── Reads ──────────────────────────────────────────────────────────

function groupQuotationTotal(
  procedureSessionId: string | null,
  lines: QuotationLine[],
  financialPlan: unknown,
): number | null {
  if (procedureSessionId) return null
  if (lines.length > 0) return quoteTotal(lines)
  const planTotal = (financialPlan as { totalAmount?: number | string | null } | null)?.totalAmount
  if (planTotal == null) return null
  const parsed = Number(planTotal)
  return Number.isFinite(parsed) ? parsed : null
}

async function selectGroupDetails(
  txDb: typeof db,
  tenantId: string,
  where: ReturnType<typeof and>,
): Promise<DiagramGroupDetail[]> {
  const rows = await txDb
    .select({
      id: faceDiagramGroups.id,
      patientId: faceDiagramGroups.patientId,
      practitionerId: faceDiagramGroups.practitionerId,
      practitionerName: users.fullName,
      origin: faceDiagramGroups.origin,
      procedureRecordId: faceDiagramGroups.procedureRecordId,
      procedureSessionId: faceDiagramGroups.procedureSessionId,
      declinedAt: faceDiagramGroups.declinedAt,
      quotationLines: faceDiagramGroups.quotationLines,
      createdAt: faceDiagramGroups.createdAt,
      updatedAt: faceDiagramGroups.updatedAt,
      sessionOrdinal: procedureSessions.sessionOrdinal,
      sessionPerformedAt: procedureSessions.performedAt,
      procedureStatus: procedureRecords.status,
      procedurePerformedAt: procedureRecords.performedAt,
      financialPlan: procedureRecords.financialPlan,
      procedureTypeName: procedureTypes.name,
    })
    .from(faceDiagramGroups)
    .innerJoin(patients, eq(patients.id, faceDiagramGroups.patientId))
    .leftJoin(users, eq(users.id, faceDiagramGroups.practitionerId))
    .leftJoin(procedureRecords, eq(procedureRecords.id, faceDiagramGroups.procedureRecordId))
    .leftJoin(procedureTypes, eq(procedureTypes.id, procedureRecords.procedureTypeId))
    .leftJoin(procedureSessions, eq(procedureSessions.id, faceDiagramGroups.procedureSessionId))
    .where(and(where, isNull(patients.deletedAt)))
    .orderBy(desc(faceDiagramGroups.createdAt))

  if (rows.length === 0) return []

  const diagramRows = await txDb
    .select({ id: faceDiagrams.id, viewType: faceDiagrams.viewType, groupId: faceDiagrams.groupId })
    .from(faceDiagrams)
    .where(
      and(
        eq(faceDiagrams.tenantId, tenantId),
        inArray(faceDiagrams.groupId, rows.map((r) => r.id)),
      ),
    )
  const views = await loadDiagramsWithPoints(txDb, diagramRows)
  const groupOf = new Map(diagramRows.map((d) => [d.id, d.groupId]))

  return rows.map((r) => {
    const lines = (r.quotationLines as QuotationLine[] | null) ?? []
    return {
      id: r.id,
      patientId: r.patientId,
      practitionerId: r.practitionerId,
      practitionerName: r.practitionerName,
      origin: r.origin as DiagramGroupOrigin,
      status: deriveDiagramStatus({
        isSessionGroup: !!r.procedureSessionId,
        procedureStatus: (r.procedureStatus as ProcedureStatus | null) ?? null,
        declinedAt: r.declinedAt,
      }),
      procedureRecordId: r.procedureRecordId,
      procedureSessionId: r.procedureSessionId,
      sessionOrdinal: r.sessionOrdinal,
      procedureTypeName: r.procedureTypeName,
      procedurePerformedAt: r.sessionPerformedAt ?? r.procedurePerformedAt,
      quotationLines: lines,
      quotationTotal: groupQuotationTotal(r.procedureSessionId, lines, r.financialPlan),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      views: views.filter((v) => groupOf.get(v.id) === r.id),
    }
  })
}

export async function getDiagramGroup(
  tenantId: string,
  groupId: string,
  txDb: typeof db = db,
): Promise<DiagramGroupDetail | null> {
  const [group] = await selectGroupDetails(
    txDb,
    tenantId,
    and(
      eq(faceDiagramGroups.id, groupId),
      eq(faceDiagramGroups.tenantId, tenantId),
      isNull(faceDiagramGroups.deletedAt),
    ),
  )
  return group ?? null
}

export async function listPatientDiagramGroups(
  tenantId: string,
  patientId: string,
): Promise<DiagramGroupDetail[]> {
  return selectGroupDetails(
    db,
    tenantId,
    and(
      eq(faceDiagramGroups.tenantId, tenantId),
      eq(faceDiagramGroups.patientId, patientId),
      isNull(faceDiagramGroups.deletedAt),
    ),
  )
}
