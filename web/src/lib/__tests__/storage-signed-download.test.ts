import { describe, expect, it, vi } from 'vitest'

/**
 * The download name comes from the patient's WhatsApp document. storage-js puts
 * it into the signed URL unencoded, so `&`, `=` or `#` would rewrite the query.
 */

vi.mock('@/lib/supabase/storage-client', async () => {
  const { StorageClient } = await import('@supabase/storage-js')
  const fetchStub = async () =>
    new Response(JSON.stringify({ signedURL: '/object/sign/floraclin/t1/whatsapp/1?token=tok' }), {
      headers: { 'content-type': 'application/json' },
    })
  const storage = new StorageClient('https://proj.supabase.co/storage/v1', {}, fetchStub as typeof fetch)
  return { createStorageClient: () => ({ storage }) }
})

import { getSignedUrl } from '@/lib/storage'

describe('getSignedUrl with a download name', () => {
  it('keeps a hostile file name from adding query parameters', async () => {
    const url = new URL((await getSignedUrl('t1/whatsapp/1', 60, 'a&token=x#b=c.pdf'))!)

    expect(url.searchParams.get('token')).toBe('tok')
    expect(url.searchParams.get('download')).toBe('a_token_x_b_c.pdf')
    expect(url.hash).toBe('')
  })
})
