import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, renderHook } from '@testing-library/react'
import type { OnboardingProgressInput } from '@/validations/onboarding'
import { AUTOSAVE_DELAY_MS, useOnboardingAutosave } from '../use-onboarding-autosave'

const withPhone = (phone: string): OnboardingProgressInput => ({ clinic: { phone } })

function renderAutosave() {
  return renderHook((progress: OnboardingProgressInput) => useOnboardingAutosave(progress), {
    initialProps: withPhone(''),
  })
}

function savedPhones(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/onboarding/progress')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string).clinic.phone)
}

function deferred() {
  let resolve!: (res: Response) => void
  const promise = new Promise<Response>((r) => { resolve = r })
  return { promise, resolve }
}

const leavePage = () => act(() => { fireEvent(window, new Event('pagehide')) })

describe('useOnboardingAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('saves nothing while the owner types and once after the pause', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ saved: true }))
    const { rerender } = renderAutosave()

    for (const phone of ['1', '11', '119', '1198']) {
      rerender(withPhone(phone))
      await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS / 2))
    }
    expect(savedPhones(fetchMock)).toEqual([])

    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(savedPhones(fetchMock)).toEqual(['1198'])
    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/progress', expect.objectContaining({ method: 'PATCH', keepalive: true }))
  })

  it('saves right away when the owner leaves the page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ saved: true }))
    const { rerender } = renderAutosave()

    rerender(withPhone('(11) 98888-7777'))
    leavePage()

    expect(savedPhones(fetchMock)).toEqual(['(11) 98888-7777'])
  })

  // Regression: a body was marked saved before the request answered, so a
  // failed save was never sent again, not even on leaving the page.
  it.each([
    ['answers with an error', () => Promise.resolve(Response.json({ error: 'x' }, { status: 500 }))],
    ['never reaches the server', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('sends a save again on leaving the page when it %s', async (_label, firstAnswer) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(firstAnswer)
      .mockImplementation(async () => Response.json({ saved: true }))
    const { rerender } = renderAutosave()

    rerender(withPhone('(11) 98888-7777'))
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    leavePage()
    await act(() => vi.advanceTimersByTimeAsync(0))
    leavePage()

    expect(savedPhones(fetchMock)).toEqual(['(11) 98888-7777', '(11) 98888-7777'])
  })

  // Regression: saves were sent as they came, so an older one could land last.
  it('sends one save at a time and then only the newest waiting body', async () => {
    const first = deferred()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => Response.json({ saved: true }))
    const { rerender } = renderAutosave()

    rerender(withPhone('(11) 9'))
    leavePage()
    rerender(withPhone('(11) 98'))
    leavePage()
    rerender(withPhone('(11) 988'))
    leavePage()
    expect(savedPhones(fetchMock)).toEqual(['(11) 9'])

    await act(async () => { first.resolve(Response.json({ saved: true })) })
    expect(savedPhones(fetchMock)).toEqual(['(11) 9', '(11) 988'])
  })
})
