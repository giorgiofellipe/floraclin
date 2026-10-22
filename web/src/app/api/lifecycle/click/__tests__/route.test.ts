import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const q = vi.hoisted(() => ({
  findLifecycleSendForClick: vi.fn(),
  recordLifecycleClick: vi.fn(),
}))
vi.mock('@/db/queries/lifecycle', () => q)
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.test' }))

import { GET } from '../route'

const SEND_ID = '6f1c2b8e-4a1d-4c3b-9e2f-0a1b2c3d4e5f'
const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const WHATSAPP_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 WhatsApp/2.24.21.80'
const send = {
  id: SEND_ID,
  tenantId: 'tenant-1',
  messageKey: 'trial_first_patient',
  channel: 'whatsapp',
}

function request(query: string, userAgent: string | null = CHROME, method = 'GET') {
  return new NextRequest(`https://app.test/api/lifecycle/click?${query}`, {
    method,
    headers: userAgent ? { 'user-agent': userAgent } : {},
  })
}

function click(query: string, userAgent: string | null = CHROME) {
  return GET(request(query, userAgent))
}

describe('GET /api/lifecycle/click', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    q.findLifecycleSendForClick.mockResolvedValue(send)
    q.recordLifecycleClick.mockResolvedValue(true)
  })

  it('records the click and redirects to the message button with UTMs and no send id', async () => {
    const res = await click(`lc=${SEND_ID}`)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://app.test/pacientes?novo=1&utm_source=lifecycle&utm_medium=whatsapp&utm_campaign=trial_first_patient',
    )
    expect(q.recordLifecycleClick).toHaveBeenCalledWith(send)
  })

  it('redirects an email link scanner without recording a click', async () => {
    q.findLifecycleSendForClick.mockResolvedValue({ ...send, channel: 'email' })
    const res = await click(`lc=${SEND_ID}`, 'Microsoft Office SafeLinks/1.0')

    expect(res.headers.get('location')).toContain('/pacientes?novo=1')
    expect(q.recordLifecycleClick).not.toHaveBeenCalled()
  })

  it('does not record a HEAD check on an email send', async () => {
    q.findLifecycleSendForClick.mockResolvedValue({ ...send, channel: 'email' })
    const res = await GET(request(`lc=${SEND_ID}`, CHROME, 'HEAD'))

    expect(res.status).toBe(307)
    expect(q.recordLifecycleClick).not.toHaveBeenCalled()
  })

  it('records a browser click on an email send', async () => {
    const emailSend = { ...send, channel: 'email' }
    q.findLifecycleSendForClick.mockResolvedValue(emailSend)

    await click(`lc=${SEND_ID}`)

    expect(q.recordLifecycleClick).toHaveBeenCalledWith(emailSend)
  })

  it("records a WhatsApp tap from WhatsApp's own browser", async () => {
    await click(`lc=${SEND_ID}`, WHATSAPP_WEBVIEW)

    expect(q.recordLifecycleClick).toHaveBeenCalledWith(send)
  })

  it('sends a malformed lc to the app home without touching the database', async () => {
    const res = await click('lc=abc')

    expect(res.headers.get('location')).toBe('https://app.test/')
    expect(q.findLifecycleSendForClick).not.toHaveBeenCalled()
  })

  it('sends an unknown or unreadable send to the app home', async () => {
    q.findLifecycleSendForClick.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('db down'))

    expect((await click(`lc=${SEND_ID}`)).headers.get('location')).toBe('https://app.test/')
    expect((await click(`lc=${SEND_ID}`)).headers.get('location')).toBe('https://app.test/')
    expect(q.recordLifecycleClick).not.toHaveBeenCalled()
  })

  it('still redirects to the destination when recording the click fails', async () => {
    q.recordLifecycleClick.mockRejectedValue(new Error('insert failed'))

    const res = await click(`lc=${SEND_ID}`)

    expect(res.headers.get('location')).toContain('/pacientes?novo=1')
  })
})
