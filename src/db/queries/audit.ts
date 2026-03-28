import { db } from '@/db/client'
import { auditLogs, users } from '@/db/schema'
import { eq, and, sql, gte, lte, desc, count } from 'drizzle-orm'

export interface AuditLogWithUser {
  id: string
  tenantId: string | null
  userId: string
  action: string
  entityType: string
  entityId: string | null
  changes: unknown
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
  userName: string
}

export interface AuditLogFilters {
  entityType?: string
  entityId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

export async function listAuditLogs(
  tenantId: string,
  filters: AuditLogFilters = {}
) {
  const page = filters.page ?? 1
  const limit = filters.limit ?? 20
  const offset = (page - 1) * limit

  const conditions = [eq(auditLogs.tenantId, tenantId)]

  if (filters.entityType) {
    conditions.push(eq(auditLogs.entityType, filters.entityType))
  }

  if (filters.entityId) {
    conditions.push(eq(auditLogs.entityId, filters.entityId))
  }

  if (filters.dateFrom) {
    conditions.push(gte(auditLogs.createdAt, new Date(filters.dateFrom)))
  }

  if (filters.dateTo) {
    // Include the full end date by setting to end of day
    const endDate = new Date(filters.dateTo)
    endDate.setHours(23, 59, 59, 999)
    conditions.push(lte(auditLogs.createdAt, endDate))
  }

  const whereClause = and(...conditions)

  const [totalResult, data] = await Promise.all([
    db
      .select({ count: count() })
      .from(auditLogs)
      .where(whereClause),
    db
      .select({
        id: auditLogs.id,
        tenantId: auditLogs.tenantId,
        userId: auditLogs.userId,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        changes: auditLogs.changes,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
        userName: users.fullName,
      })
      .from(auditLogs)
      .innerJoin(users, eq(auditLogs.userId, users.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
  ])

  const total = totalResult[0]?.count ?? 0

  return {
    data: data as AuditLogWithUser[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

export async function getDistinctEntityTypes(tenantId: string): Promise<string[]> {
  const result = await db
    .selectDistinct({ entityType: auditLogs.entityType })
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(auditLogs.entityType)

  return result.map((r) => r.entityType)
}
