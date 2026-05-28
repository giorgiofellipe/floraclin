import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getTenantMock = vi.fn()
vi.mock('@/db/queries/tenants', () => ({
  getTenant: (...args: unknown[]) => getTenantMock(...args),
}))

import {
  getCredentials,
  sendTextMessage,
  getUserProfile,
  verifyCredentials,
} from '@/lib/instagram'

const VALID_SETTINGS = {
  instagram_enabled: true,
  instagram_page_id: 'page-123',
  instagram_business_account_id: 'iga-456',
  instagram_page_access_token: 'token-abc',
}

function mockTenantWithSettings(settings: Record<string, unknown> | null) {
  getTenantMock.mockResolvedValue({ id: 'tenant-1', settings })
}

function mockFetchResponse(opts: {
  ok: boolean
  status?: number
  json: unknown
}) {
  return vi.fn().mockResolvedValue({
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: vi.fn().mockResolvedValue(opts.json),
  })
}

describe('instagram client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getCredentials', () => {
    it('returns credentials when all keys present', async () => {
      mockTenantWithSettings(VALID_SETTINGS)
      const creds = await getCredentials('tenant-1')
      expect(creds).toEqual({
        pageId: 'page-123',
        igBusinessAccountId: 'iga-456',
        pageAccessToken: 'token-abc',
      })
    })

    it('throws when tenant not found', async () => {
      getTenantMock.mockResolvedValue(null)
      await expect(getCredentials('tenant-1')).rejects.toThrow('Tenant not found')
    })

    it('throws when instagram_page_id is missing', async () => {
      mockTenantWithSettings({ ...VALID_SETTINGS, instagram_page_id: null })
      await expect(getCredentials('tenant-1')).rejects.toThrow(
        'Instagram credentials missing',
      )
    })

    it('throws when instagram_business_account_id is missing', async () => {
      mockTenantWithSettings({
        ...VALID_SETTINGS,
        instagram_business_account_id: undefined,
      })
      await expect(getCredentials('tenant-1')).rejects.toThrow(
        'Instagram credentials missing',
      )
    })

    it('throws when instagram_page_access_token is missing', async () => {
      mockTenantWithSettings({
        ...VALID_SETTINGS,
        instagram_page_access_token: '',
      })
      await expect(getCredentials('tenant-1')).rejects.toThrow(
        'Instagram credentials missing',
      )
    })

    it('throws when settings is null', async () => {
      mockTenantWithSettings(null)
      await expect(getCredentials('tenant-1')).rejects.toThrow(
        'Instagram credentials missing',
      )
    })
  })

  describe('sendTextMessage', () => {
    it('builds the correct request body without the tag', async () => {
      mockTenantWithSettings(VALID_SETTINGS)
      const fetchMock = mockFetchResponse({
        ok: true,
        json: { message_id: 'mid_123', recipient_id: 'igsid-99' },
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await sendTextMessage('tenant-1', 'igsid-99', 'hello')

      expect(result).toEqual({ metaMessageId: 'mid_123' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        'https://graph.facebook.com/v21.0/me/messages?access_token=token-abc',
      )
      expect(init.method).toBe('POST')
      expect(
        (init.headers as Record<string, string>)['Content-Type'],
      ).toBe('application/json')
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        recipient: { id: 'igsid-99' },
        message: { text: 'hello' },
      })
      expect(body.messaging_type).toBeUndefined()
      expect(body.tag).toBeUndefined()
    })

    it('includes messaging_type and tag when opts.tag = HUMAN_AGENT', async () => {
      mockTenantWithSettings(VALID_SETTINGS)
      const fetchMock = mockFetchResponse({
        ok: true,
        json: { message_id: 'mid_456' },
      })
      vi.stubGlobal('fetch', fetchMock)

      await sendTextMessage('tenant-1', 'igsid-99', 'follow up', {
        tag: 'HUMAN_AGENT',
      })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        recipient: { id: 'igsid-99' },
        message: { text: 'follow up' },
        messaging_type: 'MESSAGE_TAG',
        tag: 'HUMAN_AGENT',
      })
    })

    it('throws with Meta error message on non-2xx', async () => {
      mockTenantWithSettings(VALID_SETTINGS)
      const fetchMock = mockFetchResponse({
        ok: false,
        status: 400,
        json: { error: { message: 'Invalid user ID', code: 100 } },
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        sendTextMessage('tenant-1', 'igsid-99', 'hi'),
      ).rejects.toThrow('Meta API error: Invalid user ID')
    })
  })

  describe('getUserProfile', () => {
    it('returns parsed profile on success', async () => {
      mockTenantWithSettings(VALID_SETTINGS)
      const fetchMock = mockFetchResponse({
        ok: true,
        json: {
          name: 'Jane Doe',
          username: 'janedoe',
          profile_pic: 'https://cdn.example/pic.jpg',
        },
      })
      vi.stubGlobal('fetch', fetchMock)

      const profile = await getUserProfile('tenant-1', 'igsid-99')

      expect(profile).toEqual({
        name: 'Jane Doe',
        username: 'janedoe',
        profile_pic: 'https://cdn.example/pic.jpg',
      })
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toContain('https://graph.facebook.com/v21.0/igsid-99')
      expect(url).toContain('fields=name,username,profile_pic')
      expect(url).toContain('access_token=token-abc')
    })

    it('returns {} on HTTP 400 instead of throwing', async () => {
      mockTenantWithSettings(VALID_SETTINGS)
      const fetchMock = mockFetchResponse({
        ok: false,
        status: 400,
        json: { error: { message: 'Cannot fetch private user' } },
      })
      vi.stubGlobal('fetch', fetchMock)

      const profile = await getUserProfile('tenant-1', 'igsid-99')
      expect(profile).toEqual({})
    })

    it('throws on non-400 errors', async () => {
      mockTenantWithSettings(VALID_SETTINGS)
      const fetchMock = mockFetchResponse({
        ok: false,
        status: 500,
        json: { error: { message: 'Internal server error' } },
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(getUserProfile('tenant-1', 'igsid-99')).rejects.toThrow(
        'Meta API error: Internal server error',
      )
    })
  })

  describe('verifyCredentials', () => {
    it('returns ok with igBusinessAccountId when account is linked', async () => {
      const fetchMock = mockFetchResponse({
        ok: true,
        json: { instagram_business_account: { id: 'iga-789' }, id: 'page-1' },
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await verifyCredentials('page-1', 'tok')

      expect(result).toEqual({ ok: true, igBusinessAccountId: 'iga-789' })
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toContain('https://graph.facebook.com/v21.0/page-1')
      expect(url).toContain('fields=instagram_business_account')
    })

    it('returns ok: false when response lacks instagram_business_account', async () => {
      const fetchMock = mockFetchResponse({
        ok: true,
        json: { id: 'page-1' },
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await verifyCredentials('page-1', 'tok')

      expect(result.ok).toBe(false)
      expect(result.error).toBe(
        'Page is not linked to an Instagram Business account',
      )
      expect(result.igBusinessAccountId).toBeUndefined()
    })

    it('returns ok: false when Graph API returns an error', async () => {
      const fetchMock = mockFetchResponse({
        ok: false,
        status: 401,
        json: { error: { message: 'Invalid access token' } },
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await verifyCredentials('page-1', 'bad-token')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Invalid access token')
    })

    it('catches network errors and returns ok: false', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED'))
      vi.stubGlobal('fetch', fetchMock)

      const result = await verifyCredentials('page-1', 'tok')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('ECONNREFUSED')
    })
  })
})
