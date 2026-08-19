import { describe, it, expect, vi, beforeEach } from 'vitest'

const captureExceptionMock = vi.fn<(...args: unknown[]) => string>(() => 'evt-abc123')

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

import { maskPath, reportSideEffectFailure, scrubEvent, scrubUrl } from '../observability'

describe('reportSideEffectFailure', () => {
  beforeEach(() => captureExceptionMock.mockClear())

  it('reports with the area and step, and does not return a response', () => {
    const boom = new Error('google says no')

    const result = reportSideEffectFailure(boom, {
      area: 'calendar-sync',
      step: 'push_appointment',
      extra: { appointmentId: 'a1' },
    })

    expect(result).toBeUndefined()
    expect(captureExceptionMock).toHaveBeenCalledWith(boom, {
      tags: { area: 'calendar-sync', step: 'push_appointment' },
      extra: { appointmentId: 'a1' },
    })
  })

  it('works without extra context', () => {
    reportSideEffectFailure('nope', { area: 'billing', step: 'stripe_signature' })

    expect(captureExceptionMock).toHaveBeenCalledWith('nope', {
      tags: { area: 'billing', step: 'stripe_signature' },
      extra: undefined,
    })
  })
})

describe('maskPath', () => {
  it.each([
    ['/api/patients/0f8fad5b-d9cb-469f-a165-70867728950e', '/api/patients/:id'],
    // A uuid that happens to start with a letter is still a uuid. An earlier
    // version of the allowlist let this exact shape through.
    ['/api/patients/c123e456-e89b-12d3-a456-426614174000', '/api/patients/:id'],
    ['/api/patients/abcdefab-abcd-abcd-abcd-abcdefabcdef', '/api/patients/:id'],
    // The anamnesis token is a live credential sitting in the path.
    [
      '/api/anamnesis/token/af2a1c8b7e6d5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e',
      '/api/anamnesis/token/:id',
    ],
    ['/api/appointments/12345/status', '/api/appointments/:id/status'],
    ['/api/reports/procedimentos-realizados', '/api/reports/procedimentos-realizados'],
    ['/api/whatsapp/templates', '/api/whatsapp/templates'],
    ['/api/financial/bulk/cancel', '/api/financial/bulk/cancel'],
  ])('%s -> %s', (input, expected) => {
    expect(maskPath(input)).toBe(expected)
  })

  it('leaves every real static route untouched', () => {
    // Every static segment under src/app/api is kebab-case letters only. If
    // someone adds one with a digit, this is the test that should fail.
    for (const path of [
      '/api/procedure-types',
      '/api/clinical-documents',
      '/api/cron/whatsapp-automations',
      '/api/reports/ganhos-profissional',
      '/api/financial/settings/categories',
    ]) {
      expect(maskPath(path)).toBe(path)
    }
  })
})

describe('scrubUrl', () => {
  it('masks the password-reset token and the e-mail it is addressed to', () => {
    const scrubbed = scrubUrl(
      'https://app.floraclin.com.br/reset-password?token=live-token-value&email=ana@clinica.com.br',
    )

    expect(scrubbed).not.toContain('live-token-value')
    expect(scrubbed).not.toContain('ana@clinica.com.br')
    expect(scrubbed).toContain('/reset-password')
  })

  it('keeps parameters that are not credentials', () => {
    expect(scrubUrl('https://app.floraclin.com.br/api/reports/prontuario?format=pdf')).toContain(
      'format=pdf',
    )
  })

  it('masks the path as well as the query', () => {
    expect(scrubUrl('https://app.floraclin.com.br/pacientes/0f8fad5b-d9cb-469f-a165-70867728950e'))
      .toBe('https://app.floraclin.com.br/pacientes/:id')
  })
})

describe('scrubEvent', () => {
  it('scrubs the request url and drops the query string the SDK attaches', () => {
    const event = scrubEvent({
      request: {
        url: 'https://app.floraclin.com.br/reset-password?token=live&email=ana@x.com',
        query_string: 'token=live&email=ana@x.com',
      },
    } as never)

    expect(event.request?.url).not.toContain('live')
    expect(event.request?.query_string).toBeUndefined()
  })

  it('scrubs navigation breadcrumbs, which carry the same urls', () => {
    const event = scrubEvent({
      breadcrumbs: [
        { data: { from: '/reset-password?token=live', to: '/pacientes/0f8fad5b-d9cb-469f-a165-70867728950e' } },
      ],
    } as never)

    expect(event.breadcrumbs?.[0].data?.from).not.toContain('live')
    expect(event.breadcrumbs?.[0].data?.to).toBe('/pacientes/:id')
  })

  it('passes an event with nothing to scrub straight through', () => {
    const event = { message: 'boom' } as never
    expect(scrubEvent(event)).toBe(event)
  })
})
