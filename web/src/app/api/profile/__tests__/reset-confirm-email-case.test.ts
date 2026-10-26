import { describe, expect, it, vi } from 'vitest'

/**
 * Invited and Google accounts keep the email casing they were created with. A
 * case-sensitive match consumed the reset link but changed no password.
 */

const captured: { sql: string; params: unknown[] }[] = []

vi.mock('@/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return {
    db: drizzle(async (sql: string, params: unknown[]) => {
      captured.push({ sql, params })
      return { rows: sql.startsWith('delete') ? [['dona@clinica.com.br', 'hash', new Date(Date.now() + 60_000).toISOString()]] : [] }
    }),
  }
})

import { POST } from '../reset-confirm/route'

describe('POST /api/profile/reset-confirm', () => {
  it('matches the account email without regard to case', async () => {
    const res = await POST(
      new Request('http://localhost/api/profile/reset-confirm', {
        method: 'POST',
        body: JSON.stringify({ token: 't', email: 'Dona@Clinica.com.br', newPassword: 'nova-senha-1' }),
      }),
    )

    expect(res.status).toBe(200)
    const update = captured.find(({ sql }) => sql.startsWith('update "floraclin"."users"'))
    expect(update?.sql).toMatch(/where lower\("floraclin"\."users"\."email"\) = \$\d+$/)
    expect(update?.params.at(-1)).toBe('dona@clinica.com.br')
  })
})
