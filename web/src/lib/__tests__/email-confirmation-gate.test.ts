// @vitest-environment node
/**
 * An owner who signed up with a password uses the app before confirming the
 * address, but nothing that reaches someone else on that address's word:
 * WhatsApp on the shared number, team invites, checkout.
 */
import { describe, expect, it } from 'vitest'
import { EmailConfirmationRequiredError, emailConfirmationGate } from '../email-confirmation-gate'
import { handleApiError } from '../api-error'

describe('emailConfirmationGate (the signed-in user)', () => {
  it('answers 403 email_unconfirmed for an unconfirmed user', async () => {
    const res = emailConfirmationGate({ emailVerified: false, isPlatformAdmin: false })
    expect(res?.status).toBe(403)
    expect(await res?.json()).toMatchObject({ code: 'email_unconfirmed' })
  })

  it('lets a confirmed user and a platform admin through', () => {
    expect(emailConfirmationGate({ emailVerified: true, isPlatformAdmin: false })).toBeNull()
    expect(emailConfirmationGate({ emailVerified: false, isPlatformAdmin: true })).toBeNull()
  })
})

describe('EmailConfirmationRequiredError', () => {
  it('maps to 403 email_unconfirmed in the API', async () => {
    const res = handleApiError(new EmailConfirmationRequiredError())
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'email_unconfirmed' })
  })
})
