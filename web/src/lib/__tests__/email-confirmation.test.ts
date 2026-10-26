import { describe, it, expect, vi } from 'vitest'

// Someone can sign up with another person's address. The warning is the only
// thing telling that person which clinic they would be confirming access to.

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn() }
  },
}))

vi.mock('@/lib/email-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-layout')>()
  return { ...actual, renderEmailLayout: vi.fn(actual.renderEmailLayout) }
})

import { renderEmailLayout } from '@/lib/email-layout'
import { sendConfirmationEmail } from '../email'

describe('sendConfirmationEmail', () => {
  it('names the clinic in the "not you" warning', async () => {
    await sendConfirmationEmail('vitima@clinica.com.br', 'https://app/confirm', 'Clínica Fantasma')

    const { notes } = vi.mocked(renderEmailLayout).mock.calls[0][0]
    expect(notes?.some((note) => note.includes('Clínica Fantasma'))).toBe(true)
  })
})
