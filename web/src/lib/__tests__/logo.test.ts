/**
 * `signLogoPath` and `fetchLogoDataUri` sit on render paths: report PDFs, the
 * print pages, the public booking page. Neither may ever throw, because a
 * clinic's prontuário must not 500 over a logo. These tests pin that down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// storage-client has a server-only guard that throws in jsdom (where `window`
// exists). Mock it so importing @/lib/logo -> @/lib/storage doesn't trip the
// guard at module load.
const createSignedUrl = vi.fn()
vi.mock('@/lib/supabase/storage-client', () => ({
  createStorageClient: vi.fn(() => ({
    storage: { from: () => ({ createSignedUrl }) },
  })),
}))

import { signLogoPath, fetchLogoDataUri, LOGO_SIGNED_URL_TTL } from '@/lib/logo'

const PATH = 'tenant-1/branding/logo-abc.png'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('signLogoPath', () => {
  it('signs the stored path with the short TTL', async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://xyz.supabase.co/storage/v1/object/sign/floraclin/logo.png?token=t' },
      error: null,
    })

    const url = await signLogoPath(PATH)

    expect(url).toBe(
      'https://xyz.supabase.co/storage/v1/object/sign/floraclin/logo.png?token=t',
    )
    expect(createSignedUrl).toHaveBeenCalledWith(PATH, LOGO_SIGNED_URL_TTL)
    expect(LOGO_SIGNED_URL_TTL).toBe(60 * 60)
  })

  it('returns null for a tenant with no logo, without touching storage', async () => {
    expect(await signLogoPath(null)).toBeNull()
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('returns null when storage reports an error', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'not found' } })

    expect(await signLogoPath(PATH)).toBeNull()
  })

  it('returns null instead of throwing when the storage client blows up', async () => {
    createSignedUrl.mockRejectedValue(new Error('connection refused'))

    await expect(signLogoPath(PATH)).resolves.toBeNull()
  })
})

/** Minimal stand-in for the parts of `Response` `fetchLogoDataUri` reads. */
function fakeResponse(args: {
  ok?: boolean
  status?: number
  contentType?: string
  body?: Uint8Array
}) {
  return {
    ok: args.ok ?? true,
    status: args.status ?? 200,
    headers: { get: (name: string) => (name === 'content-type' ? (args.contentType ?? null) : null) },
    arrayBuffer: async () => (args.body ?? new Uint8Array()).buffer,
  }
}

describe('fetchLogoDataUri', () => {
  it('returns a base64 data URI on success', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ contentType: 'image/png', body: bytes })),
    )

    const uri = await fetchLogoDataUri('https://storage.example.com/logo.png?token=t')

    expect(uri).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`)
  })

  it('strips charset parameters off the content type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({ contentType: 'image/svg+xml; charset=utf-8', body: new Uint8Array([9]) }),
      ),
    )

    const uri = await fetchLogoDataUri('https://storage.example.com/logo.svg?token=t')

    expect(uri).toBe(`data:image/svg+xml;base64,${Buffer.from([9]).toString('base64')}`)
  })

  it('returns null for a null URL, without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchLogoDataUri(null)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 403, contentType: 'image/png' })),
    )

    expect(await fetchLogoDataUri('https://storage.example.com/logo.png')).toBeNull()
  })

  it('returns null when the response is not an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({ contentType: 'application/json', body: new Uint8Array([1]) }),
      ),
    )

    expect(await fetchLogoDataUri('https://storage.example.com/logo.png')).toBeNull()
  })

  it('returns null when the body is larger than the 1 MB upload cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({ contentType: 'image/png', body: new Uint8Array(1024 * 1024 + 1) }),
      ),
    )

    expect(await fetchLogoDataUri('https://storage.example.com/logo.png')).toBeNull()
  })

  it('returns null on an empty body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ contentType: 'image/png', body: new Uint8Array() })),
    )

    expect(await fetchLogoDataUri('https://storage.example.com/logo.png')).toBeNull()
  })

  it('returns null when storage does not answer before the timeout', async () => {
    // Honour the abort signal the way a real fetch does, so the timeout is
    // what ends this call rather than the test's own timer.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      ),
    )

    expect(await fetchLogoDataUri('https://storage.example.com/logo.png', 10)).toBeNull()
  })

  it('returns null instead of throwing on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    await expect(fetchLogoDataUri('https://storage.example.com/logo.png')).resolves.toBeNull()
  })
})
