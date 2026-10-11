import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))

import { sendLifecycleEmail } from '../email'

const base = {
  to: 'owner@clinic.com',
  subject: 'Oi',
  body: 'Corpo',
  button: null,
  optOutUrl: null,
}

beforeEach(() => {
  sendMock.mockReset()
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null })
})

describe('sendLifecycleEmail', () => {
  it('throws when Resend returns an error so a failed email is not recorded as sent', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })
    await expect(sendLifecycleEmail(base)).rejects.toThrow('domain not verified')
  })

  it('returns the Resend id on success', async () => {
    await expect(sendLifecycleEmail(base)).resolves.toEqual({ id: 'email-1' })
  })

  it('sets a monitored reply-to so the feedback email can be answered', async () => {
    await sendLifecycleEmail(base)
    expect(sendMock.mock.calls[0][0].replyTo).toBe('contato@floraclin.com.br')
  })

  it('escapes HTML in the body', async () => {
    await sendLifecycleEmail({ ...base, body: '<script>alert(1)</script>' })
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('renders the opt-out footer only when optOutUrl is set', async () => {
    await sendLifecycleEmail(base)
    expect(sendMock.mock.calls[0][0].html).not.toContain('Não quer mais receber')

    await sendLifecycleEmail({ ...base, optOutUrl: 'https://app.test/optout?t=abc' })
    const html = sendMock.mock.calls[1][0].html as string
    expect(html).toContain('Não quer mais receber dicas da FloraClin?')
    expect(html).toContain('href="https://app.test/optout?t=abc"')
  })

  it('renders the button only when provided', async () => {
    await sendLifecycleEmail(base)
    expect(sendMock.mock.calls[0][0].html).not.toContain('background: #4A6B52')

    await sendLifecycleEmail({ ...base, button: { label: 'Abrir', url: 'https://app.test/x' } })
    const html = sendMock.mock.calls[1][0].html as string
    expect(html).toContain('href="https://app.test/x"')
    expect(html).toContain('Abrir')
  })
})
