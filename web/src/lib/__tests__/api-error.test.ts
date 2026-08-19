import { describe, it, expect, vi, beforeEach } from 'vitest'

const captureExceptionMock = vi.fn<(...args: unknown[]) => string>(() => 'evt-abc123')

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

import { handleApiError } from '../api-error'
import { ForbiddenError } from '../errors'

const URL_PATIENTS = 'https://app.floraclin.com.br/api/patients?q=ana'

describe('handleApiError', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reports unexpected errors to Sentry and returns the event id in the body', async () => {
    const boom = new Error('column "foo" does not exist')

    const res = handleApiError(boom, new Request(URL_PATIENTS, { method: 'POST' }))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      error: 'Internal Server Error',
      eventId: 'evt-abc123',
    })
    expect(captureExceptionMock).toHaveBeenCalledWith(boom, {
      tags: { route: '/api/patients', method: 'POST' },
    })
  })

  it('does not report an authorization outcome', async () => {
    const res = handleApiError(new ForbiddenError('Forbidden: insufficient permissions'))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('does not report the redirect `getAuthContext` throws for a logged-out caller', async () => {
    // Shaped like a real `redirect()` throw: the message is literally
    // `NEXT_REDIRECT` and `digest` carries the encoded destination/type/status,
    // exactly what `next/navigation`'s `redirect()` produces.
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    })

    const res = handleApiError(redirectError, new Request(URL_PATIENTS))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('reports a real failure whose message merely mentions "redirect" instead of misclassifying it as an auth failure', async () => {
    // No `digest`: this is what a genuine failure looks like. The old
    // `msg.includes('redirect')` check turned it into a silent 401.
    const tooManyRedirects = new Error('Too many redirects')

    const res = handleApiError(tooManyRedirects, new Request(URL_PATIENTS))

    expect(res.status).toBe(500)
    expect(captureExceptionMock).toHaveBeenCalledWith(tooManyRedirects, expect.anything())
  })

  it('reports a real failure whose message merely mentions "Forbidden"', async () => {
    // e.g. an upstream Meta/Google call answering `403 Forbidden`. The old
    // `msg.includes('Forbidden')` check answered 403 and dropped it.
    const upstream = new Error('Request failed: 403 Forbidden')

    const res = handleApiError(upstream, new Request(URL_PATIENTS))

    expect(res.status).toBe(500)
    expect(captureExceptionMock).toHaveBeenCalledWith(upstream, expect.anything())
  })

  it('keeps a route-specific response body and still adds the event id', async () => {
    const res = handleApiError(new Error('boom'), new Request(URL_PATIENTS), {
      body: { success: false, error: 'Erro ao salvar sessão' },
    })

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Erro ao salvar sessão',
      eventId: 'evt-abc123',
    })
  })

  it('merges caller tags with the derived ones', () => {
    handleApiError(new Error('boom'), new Request(URL_PATIENTS), {
      tags: { area: 'reports', format: 'pdf' },
    })

    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { route: '/api/patients', method: 'GET', area: 'reports', format: 'pdf' },
    })
  })

  it('does not let a caller tag overwrite the derived route or method', () => {
    handleApiError(new Error('boom'), new Request(URL_PATIENTS), {
      tags: { route: 'something-else', method: undefined },
    })

    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { route: '/api/patients', method: 'GET' },
    })
  })

  describe('route tag', () => {
    const routeTag = () =>
      (captureExceptionMock.mock.calls.at(-1)?.[1] as { tags: { route?: string } }).tags.route

    it('masks a patient uuid so one issue covers every patient', () => {
      const url = 'https://app.floraclin.com.br/api/patients/0f8fad5b-d9cb-469f-a165-70867728950e'
      handleApiError(new Error('boom'), new Request(url))

      expect(routeTag()).toBe('/api/patients/:id')
    })

    it('masks the anamnesis access token, which is a live credential in the path', () => {
      // Starts with a letter on purpose: a leading digit is already caught
      // by the kebab-case rule, so only this shape exercises LONG_HEX.
      const token = 'af2a1c8b7e6d5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e'
      handleApiError(new Error('boom'), new Request(`https://app.floraclin.com.br/api/anamnesis/token/${token}`))

      expect(routeTag()).toBe('/api/anamnesis/token/:id')
    })

    it('masks numeric ids', () => {
      handleApiError(
        new Error('boom'),
        new Request('https://app.floraclin.com.br/api/appointments/12345/status'),
      )

      expect(routeTag()).toBe('/api/appointments/:id/status')
    })

    it('keeps long kebab-case static segments intact', () => {
      handleApiError(
        new Error('boom'),
        new Request('https://app.floraclin.com.br/api/reports/procedimentos-realizados'),
      )

      expect(routeTag()).toBe('/api/reports/procedimentos-realizados')
    })
  })

  it('still reports, without route context, when no request is passed', async () => {
    const res = handleApiError(new Error('boom'))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ eventId: 'evt-abc123' })
  })

  it('handles a non-Error throw', async () => {
    const res = handleApiError('just a string', new Request(URL_PATIENTS))

    expect(res.status).toBe(500)
    expect(captureExceptionMock).toHaveBeenCalledWith('just a string', expect.anything())
  })
})
