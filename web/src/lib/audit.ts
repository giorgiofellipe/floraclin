import { db } from '@/db/client'
import { auditLogs } from '@/db/schema'
import type { AuditAction } from '@/types'

interface AuditParams {
  tenantId: string | null
  userId: string
  action: AuditAction
  entityType: string
  entityId?: string
  changes?: Record<string, { old: unknown; new: unknown }>
  ipAddress?: string
  userAgent?: string
}

export async function createAuditLog(params: AuditParams, tx?: typeof db) {
  const target = tx ?? db
  await target.insert(auditLogs).values({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    changes: params.changes,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  })
}
