import { vi } from 'vitest'
import { db } from '@/db/client'
import { chain } from './drizzle-chain'

export const RESUME_TEMPLATE = {
  name: 'resume_conversation',
  language: 'pt_BR',
  category: 'UTILITY',
  status: 'APPROVED',
  purposeKey: 'resume_conversation',
  components: [{ type: 'BODY', text: 'Olá {{1}}, podemos retomar nossa conversa?' }],
}

/**
 * Answers the system-template lookup `getTemplateForTenant` runs on the shared
 * number. The calling test file must mock `@/db/client` with `db.select` as a
 * `vi.fn()` (a `vi.mock` factory is hoisted above imports, so it can't come
 * from here).
 */
export function mockSystemTemplateRows(rows: unknown[]) {
  vi.mocked(db.select).mockReturnValue(chain(rows) as never)
}
