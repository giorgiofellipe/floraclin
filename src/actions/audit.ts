'use server'

import { requireRole } from '@/lib/auth'
import {
  listAuditLogs as listAuditLogsQuery,
  getDistinctEntityTypes as getDistinctEntityTypesQuery,
} from '@/db/queries/audit'
import type { AuditLogFilters } from '@/db/queries/audit'

export async function listAuditLogsAction(filters: AuditLogFilters = {}) {
  const auth = await requireRole('owner')
  return listAuditLogsQuery(auth.tenantId, filters)
}

export async function getDistinctEntityTypesAction() {
  const auth = await requireRole('owner')
  return getDistinctEntityTypesQuery(auth.tenantId)
}
