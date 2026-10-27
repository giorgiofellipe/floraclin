import { beforeEach, describe, it, expect, vi } from 'vitest'

// Someone can sign up with another person's address. The warning is the only
// thing telling that person which clinic they would be confirming access to.

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))

vi.mock('@/lib/email-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-layout')>()
  return { ...actual, renderEmailLayout: vi.fn(actual.renderEmailLayout) }
})

import { renderEmailLayout } from '@/lib/email-layout'
import { sendConfirmationEmail } from '../email'

describe('sendConfirmationEmail', () => {
  beforeEach(() => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null })
  })

  it('names the clinic in the "not you" warning', async () => {
    await sendConfirmationEmail('vitima@clinica.com.br', 'https://app/confirm', 'Clínica Fantasma')

    const { notes } = vi.mocked(renderEmailLayout).mock.calls[0][0]
    expect(notes?.some((note) => note.includes('Clínica Fantasma'))).toBe(true)
  })

  // Resend reports API rejections in the result instead of throwing, so a
  // resolved send that ignored it made every failed confirmation look sent.
  it('rejects when Resend returns an error', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } })

    await expect(sendConfirmationEmail('a@b.com', 'https://app/confirm', 'Clínica')).rejects.toThrow(
      'domain not verified',
    )
  })
})
