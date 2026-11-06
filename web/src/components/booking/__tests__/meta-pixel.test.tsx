import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const consent = vi.hoisted(() => ({ status: 'granted' as 'unset' | 'granted' | 'denied' }))
const scripts = vi.hoisted(() => [] as string[])

vi.mock('next/script', () => ({
  default: ({ children }: { children: string }) => {
    scripts.push(children)
    return null
  },
}))
vi.mock('@/lib/cookie-consent', () => ({
  cookieConsentStatus: () => consent.status,
  subscribeCookieConsent: () => () => {},
}))

import { MetaPixel } from '../meta-pixel'

/**
 * Runs the rendered snippet against a page where fbevents.js is already
 * loaded (as after a client navigation from the app) and returns the fbq calls.
 */
function runSnippet(snippet: string): unknown[][] {
  const calls: unknown[][] = []
  const fbq = (...args: unknown[]) => {
    calls.push(args)
  }
  const fakeWindow = { fbq }
  new Function('window', 'document', 'fbq', snippet)(fakeWindow, {}, fbq)
  return calls
}

beforeEach(() => {
  consent.status = 'granted'
  scripts.length = 0
})

describe('booking MetaPixel', () => {
  // Catches the clinic's PageView also reaching a platform pixel initialised earlier in the session.
  it("sends the PageView only to the clinic's dataset", () => {
    render(<MetaPixel datasetId="987654321" />)

    expect(scripts).toHaveLength(1)
    expect(runSnippet(scripts[0])).toEqual([
      ['consent', 'grant'],
      ['init', '987654321'],
      ['trackSingle', '987654321', 'PageView'],
    ])
  })

  it.each([
    ['no dataset', null],
    ['a non-numeric dataset', "1');alert(1);('"],
  ])('loads nothing with %s', (_label, datasetId) => {
    render(<MetaPixel datasetId={datasetId} />)

    expect(scripts).toEqual([])
  })

  it.each(['unset', 'denied'] as const)('loads nothing when consent is %s', (status) => {
    consent.status = status

    render(<MetaPixel datasetId="987654321" />)

    expect(scripts).toEqual([])
  })
})
