import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { rowsFromExecuteResult } from '@/db/queries/admin-tenants'

/** Resolves once some session waits on an advisory lock in this database (fails after ~5 s). */
export async function untilAdvisoryLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const result = await db.execute(sql`
      select 1 from pg_locks
      where locktype = 'advisory' and not granted
        and database = (select oid from pg_database where datname = current_database())
      limit 1
    `)
    if (rowsFromExecuteResult(result).length > 0) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('no session ever waited on the advisory lock')
}
