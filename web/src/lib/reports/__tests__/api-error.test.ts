import { describe, it, expect, vi, beforeEach } from 'vitest'

const captureExceptionMock = vi.fn<(...args: unknown[]) => string>(() => 'evt-abc123')

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

import { reportRouteError } from '../api-error'

const URL_JSON = 'https://app.floraclin.com.br/api/reports/prontuario?patientId=p1'
const URL_PDF = `${URL_JSON}&format=pdf`

describe('reportRouteError', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reports unexpected errors to Sentry and returns the event id in the body', async () => {
    const boom = new Error('Cannot access VIEW_LABELS.front on the server.')

    const res = reportRouteError(boom, new Request(URL_PDF))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      error: 'Internal Server Error',
      eventId: 'evt-abc123',
    })
    expect(captureExceptionMock).toHaveBeenCalledOnce()
    expect(captureExceptionMock).toHaveBeenCalledWith(boom, {
      tags: { area: 'reports', route: '/api/reports/prontuario', format: 'pdf' },
    })
  })

  it('tags the JSON branch as such so a 500 can be told apart from a PDF failure', () => {
    reportRouteError(new Error('kaboom'), new Request(URL_JSON))

    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { area: 'reports', route: '/api/reports/prontuario', format: 'json' },
    })
  })

  it('still reports, without route context, when no request is passed', async () => {
    const res = reportRouteError(new Error('kaboom'))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ eventId: 'evt-abc123' })
  })

  it('does not report authorization outcomes — those are expected, not bugs', async () => {
    const forbidden = reportRouteError(new Error('Forbidden'), new Request(URL_PDF))
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toEqual({ error: 'Forbidden' })

    // Shaped like a real `redirect()` throw: message is literally
    // `NEXT_REDIRECT` and `digest` carries the encoded destination/type/
    // status, exactly what `next/navigation`'s `redirect()` produces (see
    // `node_modules/next/dist/client/components/redirect.js`).
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    })
    const unauthorized = reportRouteError(redirectError, new Request(URL_PDF))
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toEqual({ error: 'Unauthorized' })

    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('reports a real error whose message merely mentions "redirect" instead of misclassifying it as an auth failure', async () => {
    // No `digest` at all: this is what a genuine failure looks like, e.g.
    // headless Chromium bailing out of the PDF branch.
    const tooManyRedirects = new Error('Too many redirects')

    const res = reportRouteError(tooManyRedirects, new Request(URL_PDF))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ eventId: 'evt-abc123' })
    expect(captureExceptionMock).toHaveBeenCalledWith(tooManyRedirects, expect.anything())
  })

  it('handles a non-Error throw', async () => {
    const res = reportRouteError('just a string', new Request(URL_PDF))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ eventId: 'evt-abc123' })
    expect(captureExceptionMock).toHaveBeenCalledWith('just a string', expect.anything())
  })
})
