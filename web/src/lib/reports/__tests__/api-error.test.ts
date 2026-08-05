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

    const unauthorized = reportRouteError(new Error('NEXT_REDIRECT'), new Request(URL_PDF))
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toEqual({ error: 'Unauthorized' })

    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('handles a non-Error throw', async () => {
    const res = reportRouteError('just a string', new Request(URL_PDF))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ eventId: 'evt-abc123' })
    expect(captureExceptionMock).toHaveBeenCalledWith('just a string', expect.anything())
  })
})
