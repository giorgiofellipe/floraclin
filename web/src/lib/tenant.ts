import { db } from '@/db/client'

// App-level tenant isolation. RLS is deferred to post-MVP hardening.
// Every query function in db/queries/ takes tenantId as first param
// and MUST include WHERE tenant_id = tenantId in all queries.
//
// This helper wraps a callback with the tenant context for convenience.
// It does NOT set any DB session variables — isolation is purely app-level.
export async function withTenant<T>(
  tenantId: string,
  fn: (tenantId: string) => Promise<T>
): Promise<T> {
  return fn(tenantId)
}

// Transaction wrapper for multi-table writes (e.g., procedure save).
// All writes within the callback share a single transaction.
export async function withTransaction<T>(
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx as unknown as typeof db)
  })
}
