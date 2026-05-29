import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { procedureRecords, procedureSessions } from '@/db/schema'

export type ProcedureSessionRow = typeof procedureSessions.$inferSelect

export interface CreateSessionInput {
  tenantId: string
  procedureRecordId: string
  executedBy: string
  performedAt: Date
  technique?: string | null
  clinicalResponse?: string | null
  adverseEffects?: string | null
  notes?: string | null
  followUpDate?: string | null
  nextSessionObjectives?: string | null
  /**
   * When provided, asserts that `MAX(sessionOrdinal) + 1 === expectedOrdinal`
   * *inside the transaction*. Callers are expected to have taken a `FOR UPDATE`
   * lock on the parent `procedure_records` row before invoking this so the
   * assertion is meaningful. If the assertion fails, throws
   * `Error('concurrent_session_insert')`.
   *
   * When omitted, the next ordinal is simply computed from `MAX + 1` with no
   * concurrency check.
   */
  expectedOrdinal?: number
}

export async function createSession(
  input: CreateSessionInput,
  tx: typeof db = db,
): Promise<ProcedureSessionRow> {
  const [{ nextOrdinal }] = await tx
    .select({
      nextOrdinal: sql<number>`COALESCE(MAX(${procedureSessions.sessionOrdinal}), 0) + 1`,
    })
    .from(procedureSessions)
    .where(eq(procedureSessions.procedureRecordId, input.procedureRecordId))

  if (input.expectedOrdinal !== undefined && nextOrdinal !== input.expectedOrdinal) {
    throw new Error('concurrent_session_insert')
  }

  const [row] = await tx
    .insert(procedureSessions)
    .values({
      tenantId: input.tenantId,
      procedureRecordId: input.procedureRecordId,
      sessionOrdinal: nextOrdinal,
      performedAt: input.performedAt,
      executedBy: input.executedBy,
      technique: input.technique ?? null,
      clinicalResponse: input.clinicalResponse ?? null,
      adverseEffects: input.adverseEffects ?? null,
      notes: input.notes ?? null,
      followUpDate: input.followUpDate ?? null,
      nextSessionObjectives: input.nextSessionObjectives ?? null,
    })
    .returning()
  return row
}

export async function listSessionsForRecord(
  procedureRecordId: string,
  tx: typeof db = db,
): Promise<ProcedureSessionRow[]> {
  return tx
    .select()
    .from(procedureSessions)
    .where(eq(procedureSessions.procedureRecordId, procedureRecordId))
    .orderBy(asc(procedureSessions.sessionOrdinal))
}

export async function countSessionsForRecord(
  procedureRecordId: string,
  tx: typeof db = db,
): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(procedureSessions)
    .where(eq(procedureSessions.procedureRecordId, procedureRecordId))
  return n
}

export async function getSessionByOrdinal(
  procedureRecordId: string,
  ordinal: number,
  tx: typeof db = db,
): Promise<ProcedureSessionRow | null> {
  const [row] = await tx
    .select()
    .from(procedureSessions)
    .where(
      and(
        eq(procedureSessions.procedureRecordId, procedureRecordId),
        eq(procedureSessions.sessionOrdinal, ordinal),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function listSessionsForAtendimento(
  atendimentoId: string,
  tx: typeof db = db,
): Promise<ProcedureSessionRow[]> {
  const recordIds = await tx
    .select({ id: procedureRecords.id })
    .from(procedureRecords)
    .where(eq(procedureRecords.atendimentoId, atendimentoId))
  if (recordIds.length === 0) return []
  return tx
    .select()
    .from(procedureSessions)
    .where(
      inArray(
        procedureSessions.procedureRecordId,
        recordIds.map((r) => r.id),
      ),
    )
    .orderBy(asc(procedureSessions.sessionOrdinal))
}
